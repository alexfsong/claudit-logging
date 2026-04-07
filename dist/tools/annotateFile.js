/**
 * annotate_file — attach a one-line role description to a file.
 *
 * These annotations appear in get_project_map output and serve as a compact
 * substitute for reading the file. They're also searchable.
 *
 * Best called after reading/creating a file so the description is accurate.
 */
import { relative } from "path";
import { getDb } from "../db.js";
import { detectProject, gitRoot } from "../project.js";
export function annotateFile(args) {
    const db = getDb();
    const root = gitRoot();
    const project = args.project ?? detectProject();
    // Normalize to relative path from git root if possible
    let filePath = args.path;
    try {
        const rel = relative(root, args.path);
        if (!rel.startsWith(".."))
            filePath = rel;
    }
    catch {
        // keep as-is
    }
    db.prepare(`INSERT INTO file_roles (project, path, role, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(project, path) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`).run(project, filePath, args.role.trim());
    return {
        content: [
            {
                type: "text",
                text: `Annotated: ${filePath}\nRole: ${args.role}`,
            },
        ],
    };
}
