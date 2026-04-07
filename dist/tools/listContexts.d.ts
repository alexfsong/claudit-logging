export declare function listContexts(vaultPath: string): Promise<{
    content: {
        type: string;
        text: string;
    }[];
}>;
export declare function createContext(vaultPath: string, args: any): Promise<{
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
export declare function updateContext(vaultPath: string, args: any): Promise<{
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
