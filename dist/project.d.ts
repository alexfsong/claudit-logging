/**
 * Project detection and file tree utilities.
 */
/**
 * Identify the current project. Uses git remote if available, else directory name.
 * Returns a short, stable identifier like "github.com/user/repo" or "myproject".
 */
export declare function detectProject(cwd?: string): string;
/**
 * Return the git root of a directory, or the directory itself.
 */
export declare function gitRoot(cwd?: string): string;
interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: TreeNode[];
    role?: string;
}
/**
 * Build a file tree for the given root directory.
 * maxDepth limits recursion; ignores common noise dirs.
 */
export declare function buildTree(root: string, maxDepth?: number, depth?: number): TreeNode[];
/**
 * Render a tree to a compact string. Roles are inserted as [role text].
 */
export declare function renderTree(nodes: TreeNode[], roles: Map<string, string>, root: string, prefix?: string): string;
/**
 * Get git-tracked files. Falls back to filesystem walk if not in a git repo.
 */
export declare function getTrackedFiles(root: string): string[];
export {};
