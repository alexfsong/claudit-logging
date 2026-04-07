/**
 * get_context — load accumulated context for the current project.
 *
 * Returns:
 *   1. Recent sessions (last N, with task + outcome)
 *   2. Top knowledge items for this project (most recently added)
 *   3. Annotated files count and sample
 *
 * Call this at the start of a session to load prior work without spending
 * tokens on file exploration.
 */
import { getDb } from "../db.js";
import { detectProject } from "../project.js";
export function getContext(args) {
    const db = getDb();
    const project = args.project ?? detectProject();
    const sessionLimit = args.session_limit ?? 5;
    const knowledgeLimit = args.knowledge_limit ?? 10;
    // Recent sessions
    const sessions = db
        .prepare(`SELECT * FROM sessions
       WHERE project = ?
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(project, sessionLimit);
    // Top knowledge items (most recent, prioritise solutions)
    const knowledge = db
        .prepare(`SELECT * FROM knowledge
       WHERE project = ? OR project = ''
       ORDER BY CASE type
         WHEN 'solution'  THEN 0
         WHEN 'gotcha'    THEN 1
         WHEN 'pattern'   THEN 2
         WHEN 'decision'  THEN 3
         ELSE 4
       END, created_at DESC
       LIMIT ?`)
        .all(project, knowledgeLimit);
    // File annotation count
    const { count: annotatedCount } = db
        .prepare(`SELECT COUNT(*) AS count FROM file_roles WHERE project = ? OR project = ''`)
        .get(project);
    const lines = [
        `## Context for: ${project || "(global)"}`,
        "",
    ];
    // Sessions section
    if (sessions.length > 0) {
        lines.push("### Recent sessions");
        for (const s of sessions) {
            const outcome = s.outcome ? ` [${s.outcome}]` : "";
            lines.push(`- **${s.created_at.slice(0, 10)}**${outcome}: ${s.summary}`);
            if (s.task && s.task !== s.summary)
                lines.push(`  Task: ${s.task}`);
        }
        lines.push("");
    }
    else {
        lines.push("_No sessions logged yet for this project._\n");
    }
    // Knowledge section
    if (knowledge.length > 0) {
        lines.push("### Knowledge base");
        for (const k of knowledge) {
            const tags = k.tags ? JSON.parse(k.tags).join(", ") : "";
            lines.push(`- **[${k.id}] ${k.type.toUpperCase()}**: ${k.title}${tags ? ` (${tags})` : ""}`);
            // Short content preview
            const preview = k.content.split("\n")[0].slice(0, 120);
            lines.push(`  ${preview}${k.content.length > 120 ? "…" : ""}`);
        }
        lines.push("");
        lines.push(`Use \`search_knowledge\` to find specific items, or reference by [id].`);
    }
    else {
        lines.push("_No knowledge stored yet. Use `add_knowledge` to build the knowledge base._");
    }
    lines.push("");
    lines.push(`**${annotatedCount}** files annotated. Use \`get_project_map\` to see the full structure.`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
