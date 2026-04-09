/**
 * `claudit sessions` — list recent sessions for the current project.
 */

import type { CommandResult } from "./types.js";
import { getDb, type SessionRow } from "../db.js";
import { detectProject } from "../project.js";

export function sessions(args: {
  project?: string;
  cwd?: string;
  limit?: number;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);
  const limit = args.limit ?? 20;

  const rows = db
    .prepare(
      `SELECT * FROM sessions WHERE project = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(project, limit) as SessionRow[];

  if (!rows.length) {
    return {
      text: "No sessions logged for this project yet.",
      json: { project, results: [] },
    };
  }

  const lines = [`Recent sessions (${project || "global"}):`, ""];
  for (const s of rows) {
    const outcome = s.outcome ? ` [${s.outcome}]` : "";
    lines.push(`  ${s.created_at.slice(0, 10)}${outcome}: ${s.summary}`);
    if (s.task) lines.push(`    Task: ${s.task}`);
    lines.push("");
  }

  return {
    text: lines.join("\n"),
    json: {
      project,
      results: rows.map((s) => ({
        id: s.id,
        created_at: s.created_at,
        task: s.task,
        summary: s.summary,
        outcome: s.outcome,
        knowledge_ids: s.knowledge_ids ? JSON.parse(s.knowledge_ids) : [],
      })),
    },
  };
}
