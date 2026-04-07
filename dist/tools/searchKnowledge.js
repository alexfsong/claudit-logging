/**
 * search_knowledge — semantic + full-text search over the knowledge base.
 *
 * Strategy:
 *  1. FTS5 full-text search (always fast, no Ollama needed)
 *  2. If Ollama available, embed the query and re-rank results by cosine similarity
 *     then merge with any semantic-only hits not caught by FTS5
 *
 * Returns at most `limit` results (default 8), ranked by relevance.
 */
import { getDb } from "../db.js";
import { embed, cosine } from "../embed.js";
import { detectProject } from "../project.js";
export async function searchKnowledge(args) {
    const db = getDb();
    const limit = Math.min(args.limit ?? 8, 20);
    const project = args.project ?? detectProject();
    // ── FTS5 search ─────────────────────────────────────────────────────────
    // Match against current project or global (empty project) items.
    // FTS query: escape special chars.
    const ftsQuery = args.query
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `"${w}"`)
        .join(" OR ");
    let typeClause = "";
    const params = [];
    if (args.type) {
        typeClause = "AND k.type = ?";
        params.push(args.type);
    }
    const ftsRows = db
        .prepare(`SELECT k.*,
              bm25(knowledge_fts) AS score
       FROM knowledge k
       JOIN knowledge_fts ON knowledge_fts.rowid = k.id
       WHERE knowledge_fts MATCH ?
         AND (k.project = ? OR k.project = '')
         ${typeClause}
       ORDER BY score
       LIMIT ?`)
        .all(ftsQuery || '""', project, ...params, limit * 2);
    // ── Semantic re-rank ─────────────────────────────────────────────────────
    const queryVec = await embed(args.query);
    let results;
    if (queryVec) {
        // Re-rank FTS hits by cosine; also check a broader set with stored embeddings
        const allWithEmbeddings = db
            .prepare(`SELECT k.* FROM knowledge k
         WHERE k.embedding IS NOT NULL
           AND (k.project = ? OR k.project = '')
           ${typeClause}
         LIMIT 200`)
            .all(project, ...params);
        const scored = allWithEmbeddings.map((row) => {
            const vec = JSON.parse(row.embedding);
            return { ...row, score: 0, semantic: cosine(queryVec, vec) };
        });
        scored.sort((a, b) => b.semantic - a.semantic);
        // Merge: fts results + top semantic results, deduplicated
        const seen = new Set();
        const merged = [];
        for (const row of [...ftsRows, ...scored]) {
            if (seen.has(row.id))
                continue;
            seen.add(row.id);
            merged.push(row);
            if (merged.length >= limit)
                break;
        }
        results = merged;
    }
    else {
        results = ftsRows.slice(0, limit);
    }
    if (results.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `No knowledge found for query: "${args.query}"\n\nTip: use add_knowledge to store solutions and patterns as you work.`,
                },
            ],
        };
    }
    const lines = [
        `Found ${results.length} result(s) for "${args.query}" (project: ${project || "global"}):`,
        "",
    ];
    for (const row of results) {
        const tags = row.tags ? JSON.parse(row.tags).join(", ") : "";
        const files = row.file_paths
            ? JSON.parse(row.file_paths).join(", ")
            : "";
        lines.push(`### [${row.id}] ${row.type.toUpperCase()}: ${row.title}`);
        lines.push(`_${row.created_at.slice(0, 10)}_${tags ? " · " + tags : ""}`);
        lines.push("");
        lines.push(row.content);
        if (row.code) {
            lines.push("");
            lines.push("```");
            lines.push(row.code);
            lines.push("```");
        }
        if (files)
            lines.push(`\nFiles: ${files}`);
        lines.push("\n---");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
