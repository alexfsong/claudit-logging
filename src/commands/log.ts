/**
 * `claudit log` — record what happened in this session.
 *
 * Captures task, outcome, summary, and links to any knowledge items created.
 * `claudit recall` surfaces these in future sessions for the same project.
 */

import type { CommandResult } from "./types.js";
import { getDb } from "../db.js";
import { detectProject } from "../project.js";

export type Outcome = "solved" | "partial" | "blocked" | "exploratory";

export function logSession(args: {
  summary: string;
  task?: string;
  outcome?: Outcome;
  knowledge_ids?: number[];
  project?: string;
  cwd?: string;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);

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
      args.knowledge_ids?.length ? JSON.stringify(args.knowledge_ids) : null
    );

  const id = result.lastInsertRowid as number;

  const text = [
    `Session logged [id:${id}]`,
    `Project: ${project || "(global)"}`,
    `Outcome: ${args.outcome ?? "unspecified"}`,
    `Summary: ${args.summary}`,
    args.knowledge_ids?.length
      ? `Knowledge ids: ${args.knowledge_ids.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text,
    json: {
      id,
      project,
      task: args.task ?? null,
      summary: args.summary,
      outcome: args.outcome ?? null,
      knowledge_ids: args.knowledge_ids ?? [],
    },
  };
}
