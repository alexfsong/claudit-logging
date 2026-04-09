/**
 * `claudit run` — wrapper that owns the session lifecycle.
 *
 * 1. Resolve a profile (from --profile or interactive picker)
 * 2. Spawn `claude` with stdio: "inherit"
 * 3. On exit, prompt for (or use pre-supplied) session log
 * 4. Clean up active context
 * 5. Return the child's exit code
 */

import { spawn, execFileSync } from "child_process";
import { createInterface } from "readline/promises";
import { randomUUID } from "crypto";
import { rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { stdin, stdout } from "process";

import type { CommandResult } from "./types.js";
import { profileSet } from "./profile.js";
import { logSession, type Outcome } from "./log.js";
import { getDb, type ContextRow, type KnowledgeRow } from "../db.js";
import { detectProject } from "../project.js";
import { readActiveContext } from "../activeContext.js";
import { generate } from "../embed.js";

// ── Tiny interactive helpers ────────────────────────────────────────────────

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function pick(
  label: string,
  options: { label: string; value: string }[]
): Promise<string | null> {
  console.log(`\n${label}`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i].label}`);
  }
  const answer = await ask(`Choice [1-${options.length}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= options.length || isNaN(idx)) return null;
  return options[idx].value;
}

// ── Main ────────────────────────────────────────────────────────────────────

const OUTCOMES: Outcome[] = ["solved", "partial", "blocked", "exploratory"];

export async function run(args: {
  profile?: string;
  description?: string;
  passthrough: string[];
  cwd?: string;
}): Promise<number> {
  const project = detectProject(args.cwd);

  // Per-session state file so concurrent `claudit run` instances don't collide.
  const sessionId = randomUUID();
  const sessionFile = join(
    homedir(),
    ".local",
    "share",
    "claudit",
    `active-context-${sessionId}.json`
  );

  // All claudit calls inside the child inherit this env var, so profileSet,
  // profileShow, drift, etc. all read/write the session-scoped file.
  process.env.CLAUDIT_ACTIVE_FILE = sessionFile;

  // ── 1. Resolve profile ──────────────────────────────────────────────────

  if (args.profile) {
    const result = await profileSet({
      name: args.profile,
      description: args.description,
      cwd: args.cwd,
    });
    console.log(result.text);
  } else {
    // Interactive picker
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM contexts
         WHERE project = ? OR project = ''
         ORDER BY last_active_at DESC NULLS LAST, created_at DESC`
      )
      .all(project) as ContextRow[];

    const options = rows.map((r) => ({
      label: `${r.name} — ${r.description}`,
      value: r.name,
    }));
    options.push({ label: "+ create new profile", value: "__new__" });

    const chosen = await pick("Select a profile for this session:", options);

    if (chosen === null) {
      console.log("Aborted.");
      return 1;
    }

    if (chosen === "__new__") {
      const name = await ask("Profile name: ");
      if (!name) {
        console.log("Aborted.");
        return 1;
      }
      const desc = await ask("Description: ");
      if (!desc) {
        console.log("Aborted.");
        return 1;
      }
      const result = await profileSet({
        name,
        description: desc,
        cwd: args.cwd,
      });
      console.log(result.text);
    } else {
      const result = await profileSet({ name: chosen, cwd: args.cwd });
      console.log(result.text);
    }
  }

  // ── 2. Verify `claude` is on PATH ──────────────────────────────────────

  let claudePath: string;
  try {
    claudePath = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    console.error("Error: `claude` not found on PATH.");
    try { rmSync(sessionFile); } catch {}
    return 1;
  }

  // ── 3. Spawn claude ────────────────────────────────────────────────────

  const sessionStart = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log("\nLaunching claude...\n");

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(claudePath, args.passthrough, {
      stdio: "inherit",
      env: { ...process.env, CLAUDIT_WRAPPED: "1", CLAUDIT_ACTIVE_FILE: sessionFile },
    });

    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`Failed to launch claude: ${err.message}`);
      resolve(1);
    });
  });

  // ── 4. Session log ────────────────────────────────────────────────────

  console.log(`\nclaude exited (code ${exitCode}).`);

  try {
    // Gather context for auto-summary: profile + knowledge added this session.
    const active = readActiveContext();
    const db = getDb();
    const recentKnowledge = db
      .prepare(
        `SELECT id, type, title FROM knowledge
         WHERE project = ? AND created_at >= ?
         ORDER BY created_at`
      )
      .all(project, sessionStart) as Pick<KnowledgeRow, "id" | "type" | "title">[];

    let draft: string | null = null;
    if (active || recentKnowledge.length) {
      console.log("\nGenerating session summary...");
      const promptParts = [];
      if (active) promptParts.push(`Profile: ${active.name} — ${active.description}`);
      if (recentKnowledge.length) {
        promptParts.push("Knowledge added this session:");
        for (const k of recentKnowledge) {
          promptParts.push(`  [${k.id}] ${k.type.toUpperCase()}: ${k.title}`);
        }
      }
      promptParts.push(
        "",
        "Write a 1-2 sentence session summary for a developer log. Be concise and specific. Return only the summary, nothing else."
      );
      draft = await generate(promptParts.join("\n"));
    }

    let summary: string;
    if (draft) {
      console.log(`\nDraft: ${draft}`);
      const action = await ask("Accept, edit, or skip? [enter/e/s]: ");
      if (action === "s" || action === "skip") {
        console.log("No session logged.");
        summary = "";
      } else if (action === "e" || action === "edit") {
        summary = await ask("Summary: ");
      } else {
        summary = draft;
      }
    } else {
      summary = await ask("Session summary (empty to skip): ");
    }

    if (summary) {
      const outcomeStr = await ask(
        `Outcome [${OUTCOMES.join("/")}] (default exploratory): `
      );
      const outcome: Outcome = OUTCOMES.includes(outcomeStr as Outcome)
        ? (outcomeStr as Outcome)
        : "exploratory";
      const task = await ask("Task description (empty to skip): ");

      const result = logSession({
        summary,
        outcome,
        task: task || undefined,
        cwd: args.cwd,
      });
      console.log(result.text);
    } else if (!draft) {
      console.log("No session logged.");
    }
  } catch (err) {
    // Don't let a log failure change the exit code
    console.error(
      `Warning: failed to log session: ${err instanceof Error ? err.message : err}`
    );
  }

  // ── 5. Clean up ───────────────────────────────────────────────────────

  try {
    rmSync(sessionFile);
  } catch {
    // Already gone or never written — fine.
  }

  return exitCode;
}
