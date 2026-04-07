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
import type { ToolResult } from "../types.js";
export declare function getProjectMap(args: {
    dir?: string;
    max_depth?: number;
}): ToolResult;
