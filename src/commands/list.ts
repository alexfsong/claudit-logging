/**
 * `claudit list` — list knowledge items for the current project (and global).
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";
import { detectProject } from "../project.js";

export function list(args: {
  type?: string;
  project?: string;
  cwd?: string;
  limit?: number;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);
  const limit = args.limit ?? 100;

  const params: (string | number)[] = [project];
  let typeClause = "";
  if (args.type) {
    typeClause = "AND type = ?";
    params.push(args.type);
  }
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT * FROM knowledge
       WHERE (project = ? OR project = '')
       ${typeClause}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params) as KnowledgeRow[];

  if (!rows.length) {
    return {
      text: "No knowledge stored yet. Use `claudit add` to store solutions and patterns.",
      json: { project, results: [] },
    };
  }

  const lines: string[] = [
    `Knowledge base (${rows.length} items, project: ${project || "global"}):`,
    "",
  ];
  for (const r of rows) {
    const tags = r.tags ? `[${(JSON.parse(r.tags) as string[]).join(", ")}]` : "";
    const date = r.created_at.slice(0, 10);
    lines.push(`#${r.id} ${r.type.toUpperCase().padEnd(9)} ${date}  ${r.title} ${tags}`);
    const preview = r.content.split("\n").slice(0, 2).map((l) => `    ${l}`).join("\n");
    lines.push(preview);
    lines.push("");
  }

  return {
    text: lines.join("\n"),
    json: {
      project,
      results: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        tags: r.tags ? JSON.parse(r.tags) : [],
        created_at: r.created_at,
      })),
    },
  };
}
