/**
 * Embeddings via Ollama (optional). Falls back gracefully — search still works
 * via FTS5 when Ollama is unavailable.
 */
export declare function embed(text: string): Promise<number[] | null>;
export declare function cosine(a: number[], b: number[]): number;
/**
 * Generate embedding text from a knowledge item for indexing.
 */
export declare function knowledgeEmbedText(args: {
    title: string;
    content: string;
    code?: string | null;
    tags?: string[] | null;
}): string;
