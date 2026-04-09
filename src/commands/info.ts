/**
 * `claudit info` — DB stats.
 */

import type { CommandResult } from "./types.js";
import { getDb, getDbPath } from "../db.js";

export function info(): CommandResult {
  const db = getDb();
  const dbPath = getDbPath();
  const { knowledgeCount } = db
    .prepare("SELECT COUNT(*) AS knowledgeCount FROM knowledge")
    .get() as { knowledgeCount: number };
  const { sessionCount } = db
    .prepare("SELECT COUNT(*) AS sessionCount FROM sessions")
    .get() as { sessionCount: number };
  const { fileCount } = db
    .prepare("SELECT COUNT(*) AS fileCount FROM file_roles")
    .get() as { fileCount: number };
  const { projectCount } = db
    .prepare("SELECT COUNT(DISTINCT project) AS projectCount FROM knowledge")
    .get() as { projectCount: number };
  const { profileCount } = db
    .prepare("SELECT COUNT(*) AS profileCount FROM contexts")
    .get() as { profileCount: number };

  const text = [
    `claudit database: ${dbPath}`,
    `  Knowledge items   : ${knowledgeCount}`,
    `  Sessions          : ${sessionCount}`,
    `  Annotated files   : ${fileCount}`,
    `  Projects          : ${projectCount}`,
    `  Context profiles  : ${profileCount}`,
  ].join("\n");

  return {
    text,
    json: {
      db_path: dbPath,
      knowledge_count: knowledgeCount,
      session_count: sessionCount,
      annotated_count: fileCount,
      project_count: projectCount,
      profile_count: profileCount,
    },
  };
}
