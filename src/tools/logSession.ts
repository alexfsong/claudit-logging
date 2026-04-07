/**
 * log_session — record what happened in this session.
 *
 * Called at the end of a session to capture task, outcome, and summary.
 * Also links any knowledge items created during the session (by id) so
 * get_context can surface them in future related sessions.
 */

import type { ToolResult } from "../types.js";
import { getDb } from "../db.js";
import { detectProject } from "../project.js";

export function logSession(args: {
  summary: string;
  task?: string;
  outcome?: "solved" | "partial" | "blocked" | "exploratory";
  knowledge_ids?: number[];
  project?: string;
}): ToolResult {
  const db = getDb();
  const project = args.project ?? detectProject();

  const result = db
    .prepare(
      `INSERT INTO sessions (project, task, summary, outcome, knowledge_ids)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      project,
      args.task ?? null,
      args.summary,
      args.outcome ?? null,
      args.knowledge_ids?.length
        ? JSON.stringify(args.knowledge_ids)
        : null
    );

  const id = result.lastInsertRowid;

  return {
    content: [
      {
        type: "text",
        text: [
          `Session logged [id:${id}]`,
          `Project: ${project || "(global)"}`,
          `Outcome: ${args.outcome ?? "unspecified"}`,
          `Summary: ${args.summary}`,
          args.knowledge_ids?.length
            ? `Knowledge items created: ${args.knowledge_ids.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}
