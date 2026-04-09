/**
 * `claudit add` — store a knowledge item (solution, pattern, gotcha, decision, reference).
 *
 * Embeddings are generated async if Ollama is available. Async for "the CLI returns
 * immediately"; the embed promise is awaited before exit so the index is up to date.
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";
import { embed, cosine, knowledgeEmbedText } from "../embed.js";
import { detectProject } from "../project.js";

const SUGGEST_THRESHOLD = 0.75;
const SUGGEST_MAX = 3;

export type KnowledgeType = "solution" | "pattern" | "gotcha" | "decision" | "reference" | "topic";

export async function addKnowledge(args: {
  type: KnowledgeType;
  title: string;
  content: string;
  code?: string;
  file_paths?: string[];
  tags?: string[];
  project?: string;
  cwd?: string;
}): Promise<CommandResult> {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);

  const result = db
    .prepare(
      `INSERT INTO knowledge (type, project, title, content, code, file_paths, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.type,
      project,
      args.title,
      args.content,
      args.code ?? null,
      args.file_paths?.length ? JSON.stringify(args.file_paths) : null,
      args.tags?.length ? JSON.stringify(args.tags) : null
    );

  const id = result.lastInsertRowid as number;

  // Embed synchronously here (CLI invocation is short-lived; can't fire-and-forget).
  const vec = await embed(
    knowledgeEmbedText({
      title: args.title,
      content: args.content,
      code: args.code,
      tags: args.tags,
    })
  );
  if (vec) {
    db.prepare("UPDATE knowledge SET embedding = ? WHERE id = ?").run(
      JSON.stringify(vec),
      id
    );
  }

  // Suggest cross-links: scan items in the same project (or global) with embeddings
  // and report the top SUGGEST_MAX above SUGGEST_THRESHOLD. Read-only — Claude/user
  // decides whether to call `claudit link`.
  const suggestions: { id: number; title: string; type: string; similarity: number }[] = [];
  if (vec) {
    const candidates = db
      .prepare(
        `SELECT * FROM knowledge
         WHERE id != ?
           AND embedding IS NOT NULL
           AND (project = ? OR project = '')`
      )
      .all(id, project) as KnowledgeRow[];
    const scored = candidates
      .map((row) => {
        const v = JSON.parse(row.embedding!) as number[];
        return { row, similarity: cosine(vec, v) };
      })
      .filter((s) => s.similarity >= SUGGEST_THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, SUGGEST_MAX);
    for (const s of scored) {
      suggestions.push({
        id: s.row.id,
        title: s.row.title,
        type: s.row.type,
        similarity: s.similarity,
      });
    }
  }

  const typeMark: Record<KnowledgeType, string> = {
    solution: "✓",
    pattern: "◆",
    gotcha: "!",
    decision: "→",
    reference: "§",
    topic: "¶",
  };

  const lines = [
    `${typeMark[args.type]} Stored ${args.type} [id:${id}]: "${args.title}"`,
    `Project: ${project || "(global)"}`,
    args.tags?.length ? `Tags: ${args.tags.join(", ")}` : "",
    args.file_paths?.length ? `Files: ${args.file_paths.join(", ")}` : "",
    vec ? "" : "(no embedding — Ollama unavailable; FTS still works)",
  ].filter(Boolean);

  if (suggestions.length > 0) {
    lines.push("");
    lines.push("Related items (consider `claudit link`):");
    for (const s of suggestions) {
      lines.push(`  [${s.id}] ${s.type.toUpperCase()}: ${s.title}  (${s.similarity.toFixed(2)})`);
    }
  }

  return {
    text: lines.join("\n"),
    json: { id, type: args.type, title: args.title, project, embedded: !!vec, suggestions },
  };
}
