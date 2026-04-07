/**
 * log_session — record what happened in this session.
 *
 * Called at the end of a session to capture task, outcome, and summary.
 * Also links any knowledge items created during the session (by id) so
 * get_context can surface them in future related sessions.
 */
import type { ToolResult } from "../types.js";
export declare function logSession(args: {
    summary: string;
    task?: string;
    outcome?: "solved" | "partial" | "blocked" | "exploratory";
    knowledge_ids?: number[];
    project?: string;
}): ToolResult;
