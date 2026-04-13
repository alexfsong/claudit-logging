/**
 * `claudit search` — FTS5 + semantic search over the knowledge base.
 *
 * Strategy:
 *  1. FTS5 full-text (always — fast, no Ollama)
 *  2. If Ollama available, embed the query and merge with cosine-ranked items
 *     so semantic-only matches not caught by FTS5 still surface.
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";
import { embed, cosine } from "../embed.js";
import { detectProject } from "../project.js";
import { getLinksFor } from "./link.js";

export async function search(args: {
  query: string;
  project?: string;
  cwd?: string;
  type?: string;
  limit?: number;
  global?: boolean;
}): Promise<CommandResult> {
  const db = getDb();
  const limit = Math.min(args.limit ?? 8, 20);
  const project = args.global ? null : (args.project ?? detectProject(args.cwd));

  const ftsQuery = args.query
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" OR ");

  let typeClause = "";
  const params: (string | number)[] = [];
  if (args.type) {
    typeClause = "AND k.type = ?";
    params.push(args.type);
  }

  const projectClause = project !== null
    ? `AND (k.project = ? OR k.project = '')`
    : "";
  const projectParams = project !== null ? [project] : [];

  const ftsRows = db
    .prepare(
      `SELECT k.*, bm25(knowledge_fts) AS score
       FROM knowledge k
       JOIN knowledge_fts ON knowledge_fts.rowid = k.id
       WHERE knowledge_fts MATCH ?
         ${projectClause}
         ${typeClause}
       ORDER BY score
       LIMIT ?`
    )
    .all(ftsQuery || '""', ...projectParams, ...params, limit * 2) as (KnowledgeRow & {
    score: number;
  })[];

  const queryVec = await embed(args.query);
  let results: (KnowledgeRow & { score: number; semantic?: number })[];

  if (queryVec) {
    const allWithEmbeddings = db
      .prepare(
        `SELECT k.* FROM knowledge k
         WHERE k.embedding IS NOT NULL
           ${projectClause}
           ${typeClause}
         LIMIT 200`
      )
      .all(...projectParams, ...params) as KnowledgeRow[];

    const scored = allWithEmbeddings.map((row) => {
      const vec = JSON.parse(row.embedding!) as number[];
      return { ...row, score: 0, semantic: cosine(queryVec, vec) };
    });
    scored.sort((a, b) => b.semantic! - a.semantic!);

    const seen = new Set<number>();
    const merged: typeof results = [];
    for (const row of [...ftsRows, ...scored]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    results = merged;
  } else {
    results = ftsRows.slice(0, limit);
  }

  if (results.length === 0) {
    return {
      text: `No knowledge found for query: "${args.query}"\n\nTip: use \`claudit add\` to store solutions and patterns.`,
      json: { query: args.query, project, results: [] },
    };
  }

  const lines: string[] = [
    `Found ${results.length} result(s) for "${args.query}" (project: ${project || "global"}):`,
    "",
  ];

  const linksByRow = new Map<number, ReturnType<typeof getLinksFor>>();
  for (const row of results) {
    const tags = row.tags ? (JSON.parse(row.tags) as string[]).join(", ") : "";
    const files = row.file_paths
      ? (JSON.parse(row.file_paths) as string[]).join(", ")
      : "";
    const links = getLinksFor(row.id);
    linksByRow.set(row.id, links);

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
    if (files) lines.push(`\nFiles: ${files}`);
    if (links.length) {
      const formatted = links
        .map((l) => `[${l.id}]${l.kind !== "related" ? `(${l.kind})` : ""}`)
        .join(" ");
      lines.push(`Links: ${formatted}`);
    }
    lines.push("\n---");
  }

  return {
    text: lines.join("\n"),
    json: {
      query: args.query,
      project,
      results: results.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        code: r.code,
        tags: r.tags ? JSON.parse(r.tags) : [],
        file_paths: r.file_paths ? JSON.parse(r.file_paths) : [],
        created_at: r.created_at,
        semantic: r.semantic,
        links: linksByRow.get(r.id) ?? [],
      })),
    },
  };
}
