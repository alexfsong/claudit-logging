/**
 * Project detection and file tree utilities.
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { basename, join, relative } from "path";

/**
 * Identify the current project. Uses git remote if available, else directory name.
 * Returns a short, stable identifier like "github.com/user/repo" or "myproject".
 */
export function detectProject(cwd: string = process.cwd()): string {
  try {
    const remote = execSync("git remote get-url origin 2>/dev/null", {
      cwd,
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (remote) {
      // Normalize: strip protocol, .git suffix, trailing slash
      return remote
        .replace(/^(https?:\/\/|git@|ssh:\/\/)/, "")
        .replace(/^([^:/]+):/, "$1/")
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
    }
  } catch {
    // not a git repo or no remote
  }
  return basename(cwd);
}

/**
 * Return the git root of a directory, or the directory itself.
 */
export function gitRoot(cwd: string = process.cwd()): string {
  try {
    return execSync("git rev-parse --show-toplevel 2>/dev/null", {
      cwd,
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {
    return cwd;
  }
}

const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", ".cache", "coverage", ".nyc_output", "target",
  "vendor", ".DS_Store", "*.pyc",
]);

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
export function buildTree(
  root: string,
  maxDepth = 4,
  depth = 0
): TreeNode[] {
  if (depth > maxDepth) return [];
  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const name of entries) {
    if (name.startsWith(".") && depth > 0) continue;
    if (IGNORE.has(name)) continue;
    const fullPath = join(root, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      nodes.push({
        name,
        path: fullPath,
        isDir: true,
        children: buildTree(fullPath, maxDepth, depth + 1),
      });
    } else {
      nodes.push({ name, path: fullPath, isDir: false });
    }
  }
  return nodes;
}

/**
 * Render a tree to a compact string. Roles are inserted as [role text].
 */
export function renderTree(
  nodes: TreeNode[],
  roles: Map<string, string>,
  root: string,
  prefix = ""
): string {
  const lines: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const relPath = relative(root, node.path);
    const role = roles.get(relPath) ?? roles.get(node.path);
    const roleStr = role ? `  [${role}]` : "";

    if (node.isDir) {
      lines.push(`${prefix}${connector}${node.name}/${roleStr}`);
      if (node.children?.length) {
        lines.push(renderTree(node.children, roles, root, childPrefix));
      }
    } else {
      lines.push(`${prefix}${connector}${node.name}${roleStr}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * Get git-tracked files. Falls back to filesystem walk if not in a git repo.
 */
export function getTrackedFiles(root: string): string[] {
  try {
    const out = execSync("git ls-files --cached --others --exclude-standard", {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    });
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
