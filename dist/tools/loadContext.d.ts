export declare function loadContext(vaultPath: string, args: any): Promise<{
    content: {
        type: string;
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: string;
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function resolveContextPath(vaultPath: string, contextId: string): string;
