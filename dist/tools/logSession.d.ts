export declare function logSession(vaultPath: string, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
export declare function resolveContextPath(vaultPath: string, contextId: string): string;
