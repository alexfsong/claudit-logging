export declare function ollamaEmbed(text: string): Promise<number[]>;
export declare function ollamaGenerate(prompt: string, model?: string): Promise<string>;
export declare function chromaUpsert(chunks: Array<{
    id: string;
    text: string;
    metadata: Record<string, any>;
}>): Promise<void>;
export declare function chromaQuery(queryText: string, k?: number, where?: Record<string, any>): Promise<Array<{
    id: string;
    document: string;
    metadata: Record<string, any>;
    distance: number;
}>>;
export declare function chromaDeleteByPath(notePath: string): Promise<void>;
export declare function embedNote(vaultPath: string, notePath: string): Promise<void>;
export declare function embedAllNotes(vaultPath: string): Promise<number>;
