/**
 * add_knowledge — store a solution, pattern, gotcha, decision, or reference.
 *
 * Types:
 *   solution  — how to solve a specific problem in this project
 *   pattern   — reusable code pattern or convention
 *   gotcha    — something that doesn't work / edge case / trap
 *   decision  — architectural or design decision and its rationale
 *   reference — external doc / API / library note
 *
 * Embeddings are generated async if Ollama is available, making future
 * semantic searches more accurate. Not awaited — doesn't block the response.
 */
import type { ToolResult } from "../types.js";
export declare function addKnowledge(args: {
    type: "solution" | "pattern" | "gotcha" | "decision" | "reference";
    title: string;
    content: string;
    code?: string;
    file_paths?: string[];
    tags?: string[];
    project?: string;
}): Promise<ToolResult>;
