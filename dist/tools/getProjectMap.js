/**
 * get_project_map — returns a compact, annotated file tree of the project.
 *
 * Overlays stored file_roles onto the tree so each file shows a one-liner
 * description. This lets Claude understand the project structure without
 * reading individual files.
 *
 * Example output:
 *   src/
 *   ├── index.ts          [MCP server entry, tool registration]
 *   ├── db.ts             [SQLite schema + FTS5 setup]
 *   └── tools/
 *       ├── addKnowledge.ts  [store solutions/patterns/gotchas]
 *       └── searchKnowledge.ts  [FTS5 + semantic search]
 */
import { getDb } from "../db.js";
import { buildTree, detectProject, gitRoot, renderTree } from "../project.js";
export function getProjectMap(args) {
    const db = getDb();
    const root = args.dir ? args.dir : gitRoot();
    const project = detectProject(root);
    const maxDepth = args.max_depth ?? 4;
    // Load all file roles for this project
    const roleRows = db
        .prepare(`SELECT path, role FROM file_roles WHERE project = ? OR project = ''`)
        .all(project);
    const roles = new Map();
    for (const row of roleRows) {
        roles.set(row.path, row.role);
    }
    const tree = buildTree(root, maxDepth);
    const rendered = renderTree(tree, roles, root);
    const dirName = root.split("/").pop() ?? root;
    const roleCount = roleRows.length;
    const header = [
        `Project: ${project}`,
        `Root: ${root}`,
        roleCount > 0
            ? `(${roleCount} files annotated — use annotate_file to add more)`
            : "(no annotations yet — use annotate_file to describe key files)",
        "",
        `${dirName}/`,
        rendered,
    ].join("\n");
    return { content: [{ type: "text", text: header }] };
}
