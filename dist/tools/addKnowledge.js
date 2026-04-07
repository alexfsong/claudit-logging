/**
 * add_knowledge — store a solution, pattern, gotcha, decision, or reference.
 *
 * Types:
 *   solution  — how to solve a specific problem in this project
 *   pattern   — reusable code pattern or convention
 *   gotcha    — something that doesn't work / edge case / trap
 *   decision  — architectural or design decision and its rationale
 *   reference — external doc / API / library note
 *
 * Embeddings are generated async if Ollama is available, making future
 * semantic searches more accurate. Not awaited — doesn't block the response.
 */
import { getDb } from "../db.js";
import { embed, knowledgeEmbedText } from "../embed.js";
import { detectProject } from "../project.js";
export async function addKnowledge(args) {
    const db = getDb();
    const project = args.project ?? detectProject();
    const result = db
        .prepare(`INSERT INTO knowledge (type, project, title, content, code, file_paths, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(args.type, project, args.title, args.content, args.code ?? null, args.file_paths?.length ? JSON.stringify(args.file_paths) : null, args.tags?.length ? JSON.stringify(args.tags) : null);
    const id = result.lastInsertRowid;
    // Async embedding — fire and forget
    const embedText = knowledgeEmbedText({
        title: args.title,
        content: args.content,
        code: args.code,
        tags: args.tags,
    });
    embed(embedText)
        .then((vec) => {
        if (vec) {
            db.prepare("UPDATE knowledge SET embedding = ? WHERE id = ?").run(JSON.stringify(vec), id);
        }
    })
        .catch(() => { }); // Ollama not available — fine, FTS still works
    const typeEmoji = {
        solution: "✓",
        pattern: "◆",
        gotcha: "!",
        decision: "→",
        reference: "§",
    };
    return {
        content: [
            {
                type: "text",
                text: [
                    `${typeEmoji[args.type] ?? "+"} Stored ${args.type} [id:${id}]: "${args.title}"`,
                    `Project: ${project || "(global)"}`,
                    args.tags?.length ? `Tags: ${args.tags.join(", ")}` : "",
                    args.file_paths?.length ? `Files: ${args.file_paths.join(", ")}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
            },
        ],
    };
}
