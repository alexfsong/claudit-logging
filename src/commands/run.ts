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
import { readFileSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { stdin, stdout } from "process";

import { profileSet } from "./profile.js";
import { logSession, type Outcome } from "./log.js";
import { getDb, type ContextRow, type KnowledgeRow } from "../db.js";
import { detectProject } from "../project.js";
import { readActiveContext, type ActiveContext } from "../activeContext.js";
import { generateSummary } from "../embed.js";

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

// ── Session context helpers ─────────────────────────────────────────────────

function buildSystemPromptInjection(active: ActiveContext | null): string {
  const lines = [
    "You have access to the `claudit` CLI — a persistent, cross-session knowledge base for this project.",
    "claudit is your long-term memory. Use it actively throughout the session, not as an afterthought.",
    "",
    "SESSION START (do these before anything else):",
    "  claudit recall                          # load prior sessions + knowledge for this project",
    "  claudit search \"<task description>\"     # check if this problem has been solved before",
    "",
    "DURING SESSION — use these continuously:",
    "  claudit search \"<query>\"                # before investigating any non-trivial problem",
    "  claudit map [dir]                       # use instead of ls/find to explore the codebase",
    "  claudit annotate <path> \"<role>\"        # after reading any significant file",
    "  claudit profile drift \"<new task>\"      # if the user pivots to something unrelated",
    "",
    "KNOWLEDGE CAPTURE — do not skip this:",
    "  Run `claudit add` immediately after each of these events:",
    "  - Fixing a bug or resolving a non-trivial issue → claudit add solution --title \"...\" --content \"...\"",
    "  - Completing a feature, refactor, or body of work → claudit add solution --title \"...\" --content \"...\"",
    "  - Making a design or architectural decision → claudit add decision --title \"...\" --content \"...\"",
    "  - Hitting a trap, edge case, or unexpected behavior → claudit add gotcha --title \"...\" --content \"...\"",
    "  - Noticing a reusable code convention or idiom → claudit add pattern --title \"...\" --content \"...\"",
    "  Capture knowledge right after the work is done, while context is fresh.",
    "  Future sessions depend on this — if you don't save it, it's lost.",
    "",
    "SESSION END:",
    "  claudit log \"<summary>\" --outcome solved|partial|blocked|exploratory --ids <knowledge ids>",
  ];
  if (active) {
    lines.push("", `Active profile: ${active.name} — ${active.description}`);
  }
  return lines.join("\n");
}

function getClaudeSessionId(pid: number | undefined): string | null {
  if (!pid) return null;
  try {
    const path = join(homedir(), ".claude", "sessions", `${pid}.json`);
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data.sessionId ?? null;
  } catch {
    return null;
  }
}

function getSessionHistory(sessionId: string | null, sessionStartMs: number): string[] {
  try {
    const historyPath = join(homedir(), ".claude", "history.jsonl");
    const lines = readFileSync(historyPath, "utf8").split("\n").filter(Boolean);
    const prompts: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.display) continue;
        if (sessionId && entry.sessionId === sessionId) {
          prompts.push(entry.display);
        } else if (!sessionId && entry.timestamp >= sessionStartMs) {
          prompts.push(entry.display);
        }
      } catch { continue; }
    }
    return prompts.slice(-20);
  } catch {
    return [];
  }
}

function getGitDiffStat(preHead: string | null, cwd?: string): string {
  if (!preHead) return "";
  try {
    return execFileSync("git", ["diff", "--stat", preHead], {
      cwd: cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 5000,
    }).trim().slice(0, 2000);
  } catch {
    return "";
  }
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

  // ── 2. Inject claudit instructions into session ────────────────────────

  const active = readActiveContext();
  if (!args.passthrough.includes("--append-system-prompt")) {
    args.passthrough.unshift(
      "--append-system-prompt",
      buildSystemPromptInjection(active),
    );
  }

  // ── 3. Verify `claude` is on PATH ────────────────────────────────────

  let claudePath: string;
  try {
    claudePath = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
  } catch {
    console.error("Error: `claude` not found on PATH.");
    try { rmSync(sessionFile); } catch {}
    return 1;
  }

  // ── 4. Spawn claude ──────────────────────────────────────────────────

  const sessionStartMs = Date.now();
  const sessionStart = new Date(sessionStartMs).toISOString().replace("T", " ").slice(0, 19);

  let preSessionHead: string | null = null;
  try {
    preSessionHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: args.cwd ?? process.cwd(),
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {}

  console.log("\nLaunching claude...\n");

  let childPid: number | undefined;
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(claudePath, args.passthrough, {
      stdio: "inherit",
      env: { ...process.env, CLAUDIT_WRAPPED: "1", CLAUDIT_ACTIVE_FILE: sessionFile },
    });
    childPid = child.pid;

    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`Failed to launch claude: ${err.message}`);
      resolve(1);
    });
  });

  // ── 5. Session log ────────────────────────────────────────────────────

  // Wait for claude's TUI cleanup to finish writing to the terminal,
  // then reset the terminal state before our readline prompts.
  await new Promise((r) => setTimeout(r, 300));
  process.stdout.write("\x1b[0m\x1b[?25h"); // reset attrs, show cursor

  console.log(`\nclaude exited (code ${exitCode}).`);

  try {
    // Gather rich context for auto-summary.
    const db = getDb();
    const claudeSessionId = getClaudeSessionId(childPid);
    const userPrompts = getSessionHistory(claudeSessionId, sessionStartMs);
    const gitDiff = getGitDiffStat(preSessionHead, args.cwd);
    const recentKnowledge = db
      .prepare(
        `SELECT id, type, title FROM knowledge
         WHERE project = ? AND created_at >= ?
         ORDER BY created_at`
      )
      .all(project, sessionStart) as Pick<KnowledgeRow, "id" | "type" | "title">[];

    let draft: string | null = null;
    const promptParts: string[] = [];
    if (active) promptParts.push(`Profile: ${active.name} — ${active.description}`);
    if (userPrompts.length) {
      promptParts.push("User prompts this session:");
      for (const p of userPrompts) {
        promptParts.push(`  - ${p.slice(0, 200)}`);
      }
    }
    if (gitDiff) {
      promptParts.push("Files changed (git diff --stat):", gitDiff);
    }
    if (recentKnowledge.length) {
      promptParts.push("Knowledge captured:");
      for (const k of recentKnowledge) {
        promptParts.push(`  [${k.id}] ${k.type.toUpperCase()}: ${k.title}`);
      }
    }
    if (promptParts.length > 0) {
      promptParts.push(
        "",
        "Write a 1-2 sentence session summary for a developer log. Be concise and specific about what was accomplished. Return only the summary, nothing else."
      );
      console.log("\nGenerating session summary...");
      draft = await generateSummary(promptParts.join("\n"));
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

  // ── 6. Clean up ───────────────────────────────────────────────────────

  try {
    rmSync(sessionFile);
  } catch {
    // Already gone or never written — fine.
  }

  return exitCode;
}
