/**
 * annotate_file — attach a one-line role description to a file.
 *
 * These annotations appear in get_project_map output and serve as a compact
 * substitute for reading the file. They're also searchable.
 *
 * Best called after reading/creating a file so the description is accurate.
 */
import type { ToolResult } from "../types.js";
export declare function annotateFile(args: {
    path: string;
    role: string;
    project?: string;
}): ToolResult;
