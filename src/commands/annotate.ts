/**
 * `claudit annotate` — attach a one-line role description to a file.
 *
 * Annotations appear in `claudit map` output and serve as a compact substitute
 * for re-reading files. Best called right after reading or creating a file.
 */

import { relative } from "path";
import type { CommandResult } from "./types.js";
import { getDb } from "../db.js";
import { detectProject, gitRoot } from "../project.js";

export function annotate(args: {
  path: string;
  role: string;
  project?: string;
  cwd?: string;
}): CommandResult {
  const db = getDb();
  const root = gitRoot(args.cwd);
  const project = args.project ?? detectProject(args.cwd);

  let filePath = args.path;
  try {
    const rel = relative(root, args.path);
    if (!rel.startsWith("..")) filePath = rel;
  } catch {
    // keep as-is
  }

  db.prepare(
    `INSERT INTO file_roles (project, path, role, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(project, path) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`
  ).run(project, filePath, args.role.trim());

  return {
    text: `Annotated: ${filePath}\nRole: ${args.role}`,
    json: { project, path: filePath, role: args.role },
  };
}
