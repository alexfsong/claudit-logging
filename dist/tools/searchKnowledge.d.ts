/**
 * search_knowledge — semantic + full-text search over the knowledge base.
 *
 * Strategy:
 *  1. FTS5 full-text search (always fast, no Ollama needed)
 *  2. If Ollama available, embed the query and re-rank results by cosine similarity
 *     then merge with any semantic-only hits not caught by FTS5
 *
 * Returns at most `limit` results (default 8), ranked by relevance.
 */
import type { ToolResult } from "../types.js";
export declare function searchKnowledge(args: {
    query: string;
    project?: string;
    type?: string;
    limit?: number;
}): Promise<ToolResult>;
