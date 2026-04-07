/**
 * SQLite database layer.
 * DB lives at ~/.local/share/claudit/knowledge.db (or $CLAUDIT_DB).
 * Uses FTS5 for full-text search; embeddings stored as JSON blobs for cosine
 * similarity when Ollama is available.
 */
import Database from "better-sqlite3";
export declare function getDb(): Database.Database;
export declare function getDbPath(): string;
export interface KnowledgeRow {
    id: number;
    type: "solution" | "pattern" | "gotcha" | "decision" | "reference";
    project: string;
    title: string;
    content: string;
    code: string | null;
    file_paths: string | null;
    tags: string | null;
    embedding: string | null;
    created_at: string;
    updated_at: string;
}
export interface SessionRow {
    id: number;
    project: string;
    task: string | null;
    summary: string;
    outcome: string | null;
    knowledge_ids: string | null;
    created_at: string;
}
export interface FileRoleRow {
    project: string;
    path: string;
    role: string;
    updated_at: string;
}
