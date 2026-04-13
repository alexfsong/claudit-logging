/**
 * `claudit map` — annotated file tree for the current project.
 */

import type { CommandResult } from "./types.js";
import { getDb } from "../db.js";
import { buildTree, detectProject, gitRoot, renderTree } from "../project.js";

export function map(args: {
  dir?: string;
  max_depth?: number;
}): CommandResult {
  const db = getDb();
  const root = args.dir ?? gitRoot();
  const project = detectProject(root);
  const maxDepth = args.max_depth ?? 4;

  const roleRows = db
    .prepare(
      `SELECT path, role FROM file_roles WHERE project = ? OR project = ''`
    )
    .all(project) as { path: string; role: string }[];

  const roles = new Map<string, string>(roleRows.map((r) => [r.path, r.role]));
  const tree = buildTree(root, maxDepth);
  const rendered = renderTree(tree, roles, root);

  const dirName = root.split("/").pop() ?? root;
  const text = [
    `Project: ${project}`,
    `Root: ${root}`,
    roleRows.length > 0
      ? `(${roleRows.length} files annotated — use \`claudit annotate\` to add more)`
      : "(no annotations yet — use `claudit annotate` to describe key files)",
    "",
    `${dirName}/`,
    rendered,
  ].join("\n");

  return {
    text,
    json: { project, root, annotated_count: roleRows.length, tree: rendered },
  };
}
