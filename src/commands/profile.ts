/**
 * `claudit profile` — manage context profiles.
 *
 * A context profile is a named focus area (project, name, description) used as
 * a drift anchor. The active profile is stored in a single state file
 * (~/.local/share/claudit/active-context.json) and surfaced by the status line.
 *
 * Subcommands:
 *   list        — show saved profiles for current project
 *   set         — activate (and create if needed) a profile
 *   show        — print active profile details
 *   current     — print just the active name (for status line)
 *   clear       — clear active profile
 *   drift       — embed a task and compare to active profile anchor
 */

import type { CommandResult } from "./types.js";
import { getDb, type ContextRow } from "../db.js";
import { detectProject } from "../project.js";
import { embed, cosine } from "../embed.js";
import {
  readActiveContext,
  writeActiveContext,
  clearActiveContext,
  activeContextPath,
  type ActiveContext,
} from "../activeContext.js";

const DRIFT_THRESHOLD = 0.6;
const DUPLICATE_THRESHOLD = 0.85;

export function profileList(args: {
  project?: string;
  cwd?: string;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);
  const active = readActiveContext();

  const rows = db
    .prepare(
      `SELECT * FROM contexts
       WHERE project = ? OR project = ''
       ORDER BY last_active_at DESC NULLS LAST, created_at DESC`
    )
    .all(project) as ContextRow[];

  const lines: string[] = [`Context profiles for ${project || "(global)"}:`, ""];
  if (active) lines.push(`  Active: ${active.name} — ${active.description}`, "");
  else lines.push("  Active: (none)", "");

  if (!rows.length) {
    lines.push("  No saved profiles. Use `claudit profile set <name> -d \"...\"` to create one.");
  } else {
    for (const r of rows) {
      const marker = active && active.context_id === r.id ? " ←" : "";
      const last = r.last_active_at ? ` (last active ${r.last_active_at.slice(0, 10)})` : "";
      lines.push(`  ${r.name}${marker}${last}`);
      lines.push(`    ${r.description}`);
    }
  }

  return {
    text: lines.join("\n"),
    json: {
      project,
      active: active ? { id: active.context_id, name: active.name } : null,
      profiles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        last_active_at: r.last_active_at,
      })),
    },
  };
}

export async function profileSet(args: {
  name: string;
  description?: string;
  project?: string;
  cwd?: string;
}): Promise<CommandResult> {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);

  let row = db
    .prepare(`SELECT * FROM contexts WHERE project = ? AND name = ?`)
    .get(project, args.name) as ContextRow | undefined;

  let created = false;
  const dupes: { id: number; name: string; similarity: number }[] = [];

  if (!row) {
    if (!args.description) {
      throw new Error(
        `No profile "${args.name}" exists for ${project || "(global)"}. ` +
          `Pass -d "<description>" to create it.`
      );
    }

    // Dedup check: embed the new description and compare to other profiles in
    // this project. Warn (non-blocking) if any look semantically equivalent —
    // profiles should be disjoint focus areas, not near-duplicates.
    const newVec = await embed(args.description);
    if (newVec) {
      const others = db
        .prepare(
          `SELECT id, name, description, embedding FROM contexts
           WHERE project = ? AND embedding IS NOT NULL`
        )
        .all(project) as ContextRow[];
      for (const o of others) {
        try {
          const ov = JSON.parse(o.embedding!) as number[];
          const sim = cosine(newVec, ov);
          if (sim >= DUPLICATE_THRESHOLD) {
            dupes.push({ id: o.id, name: o.name, similarity: sim });
          }
        } catch {
          /* ignore */
        }
      }
    }

    const result = db
      .prepare(
        `INSERT INTO contexts (project, name, description, last_active_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(project, args.name, args.description);
    row = db
      .prepare(`SELECT * FROM contexts WHERE id = ?`)
      .get(result.lastInsertRowid) as ContextRow;
    created = true;

    if (newVec) {
      db.prepare("UPDATE contexts SET embedding = ? WHERE id = ?").run(
        JSON.stringify(newVec),
        row.id
      );
    }
  } else {
    if (args.description && args.description !== row.description) {
      db.prepare(
        `UPDATE contexts SET description = ?, embedding = NULL, last_active_at = datetime('now') WHERE id = ?`
      ).run(args.description, row.id);
      row = { ...row, description: args.description, embedding: null };
      const vec = await embed(args.description);
      if (vec) {
        db.prepare("UPDATE contexts SET embedding = ? WHERE id = ?").run(
          JSON.stringify(vec),
          row.id
        );
      }
    } else {
      db.prepare(
        `UPDATE contexts SET last_active_at = datetime('now') WHERE id = ?`
      ).run(row.id);
    }
  }

  const active: ActiveContext = {
    context_id: row.id,
    name: row.name,
    project: row.project,
    description: row.description,
    set_at: new Date().toISOString(),
  };
  writeActiveContext(active);

  const lines = [
    `${created ? "Created and activated" : "Activated"} profile: ${row.name} [id:${row.id}]`,
    `Project: ${row.project || "(global)"}`,
    `Description: ${row.description}`,
  ];
  if (dupes.length) {
    lines.push("");
    lines.push(`⚠ Description overlaps existing profile(s) (≥${DUPLICATE_THRESHOLD} cosine):`);
    for (const d of dupes) {
      lines.push(`  - ${d.name} [id:${d.id}] sim=${d.similarity.toFixed(3)}`);
    }
    lines.push(
      `  Consider \`claudit profile delete\` on the stale one, or pick a more disjoint description.`
    );
  }

  return {
    text: lines.join("\n"),
    json: { ...active, created, duplicates: dupes },
  };
}

export function profileDelete(args: {
  name: string;
  project?: string;
  cwd?: string;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);

  const row = db
    .prepare(`SELECT * FROM contexts WHERE project = ? AND name = ?`)
    .get(project, args.name) as ContextRow | undefined;
  if (!row) {
    throw new Error(`No profile "${args.name}" for ${project || "(global)"}.`);
  }

  db.prepare(`DELETE FROM contexts WHERE id = ?`).run(row.id);

  // If the deleted profile is the active one, clear the active state too.
  const active = readActiveContext();
  if (active && active.context_id === row.id) {
    clearActiveContext();
  }

  return {
    text: `Deleted profile: ${row.name} [id:${row.id}] (${project || "(global)"})`,
    json: { deleted: true, id: row.id, name: row.name, project },
  };
}

export function profileShow(args: { cwd?: string }): CommandResult {
  const active = readActiveContext();
  if (!active) {
    return {
      text: "No active profile.",
      json: { active: null },
    };
  }

  const cwdProject = detectProject(args.cwd);
  const mismatch =
    cwdProject && active.project && cwdProject !== active.project
      ? `\n\n⚠ Active profile project (${active.project}) does not match cwd project (${cwdProject}).`
      : "";

  return {
    text:
      [
        `Name:        ${active.name}`,
        `Project:     ${active.project || "(global)"}`,
        `Description: ${active.description}`,
        `Set at:      ${active.set_at}`,
        `State file:  ${activeContextPath()}`,
      ].join("\n") + mismatch,
    json: {
      ...active,
      cwd_project: cwdProject,
      mismatch: !!mismatch,
    },
  };
}

export function profileCurrent(): CommandResult {
  const active = readActiveContext();
  if (!active) {
    throw new Error("no active profile");
  }
  return {
    text: active.name,
    json: { name: active.name, id: active.context_id },
  };
}

export function profileClear(): CommandResult {
  clearActiveContext();
  return { text: "Active profile cleared.", json: { cleared: true } };
}

export async function profileDrift(args: {
  task: string;
  threshold?: number;
}): Promise<CommandResult> {
  const active = readActiveContext();
  if (!active) {
    throw new Error("No active profile. Run `claudit profile set <name>` first.");
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM contexts WHERE id = ?`)
    .get(active.context_id) as ContextRow | undefined;
  if (!row) {
    throw new Error(`Active profile [id:${active.context_id}] not found in DB. State is stale.`);
  }

  let anchorVec: number[] | null = row.embedding
    ? (JSON.parse(row.embedding) as number[])
    : null;
  if (!anchorVec) {
    anchorVec = await embed(row.description);
    if (anchorVec) {
      db.prepare("UPDATE contexts SET embedding = ? WHERE id = ?").run(
        JSON.stringify(anchorVec),
        row.id
      );
    }
  }
  if (!anchorVec) {
    return {
      text: "Drift check unavailable: Ollama not reachable.",
      json: { available: false, reason: "ollama_unavailable" },
    };
  }

  const taskVec = await embed(args.task);
  if (!taskVec) {
    return {
      text: "Drift check unavailable: failed to embed task.",
      json: { available: false, reason: "embed_failed" },
    };
  }

  const similarity = cosine(anchorVec, taskVec);
  const threshold = args.threshold ?? DRIFT_THRESHOLD;
  const drifted = similarity < threshold;

  const text = [
    `Active profile: ${row.name}`,
    `Anchor: ${row.description}`,
    `Task:   ${args.task}`,
    `Similarity: ${similarity.toFixed(3)} (threshold: ${threshold})`,
    "",
    drifted
      ? `⚠ DRIFT — task looks unrelated. Consider \`claudit log\` then \`claudit profile set\` for the new focus.`
      : `✓ on-topic`,
  ].join("\n");

  return {
    text,
    json: {
      available: true,
      profile: row.name,
      similarity,
      threshold,
      drifted,
    },
  };
}
