/**
 * get_context — load accumulated context for the current project.
 *
 * Returns:
 *   1. Recent sessions (last N, with task + outcome)
 *   2. Top knowledge items for this project (most recently added)
 *   3. Annotated files count and sample
 *
 * Call this at the start of a session to load prior work without spending
 * tokens on file exploration.
 */
import type { ToolResult } from "../types.js";
export declare function getContext(args: {
    project?: string;
    session_limit?: number;
    knowledge_limit?: number;
}): ToolResult;
