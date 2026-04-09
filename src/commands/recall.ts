/**
 * `claudit recall` — load accumulated context for the current project.
 *
 * Returns recent sessions + top knowledge items so a fresh Claude session can
 * orient itself without exploring files. Was `get_context` in the v2 MCP layer.
 */

import type { CommandResult } from "./types.js";
import { getDb, type ContextRow, type KnowledgeRow, type SessionRow } from "../db.js";
import { detectProject } from "../project.js";
import { cosine } from "../embed.js";
import { readActiveContext } from "../activeContext.js";
import { getLinksFor } from "./link.js";

export function recall(args: {
  project?: string;
  cwd?: string;
  session_limit?: number;
  knowledge_limit?: number;
}): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);
  const sessionLimit = args.session_limit ?? 5;
  const knowledgeLimit = args.knowledge_limit ?? 10;

  const sessions = db
    .prepare(
      `SELECT * FROM sessions
       WHERE project = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(project, sessionLimit) as SessionRow[];

  // Default ordering: topics first (synthesis hubs), then solutions/gotchas/etc, then date.
  const defaultOrder = `CASE type
       WHEN 'topic'     THEN 0
       WHEN 'solution'  THEN 1
       WHEN 'gotcha'    THEN 2
       WHEN 'pattern'   THEN 3
       WHEN 'decision'  THEN 4
       ELSE 5
     END, created_at DESC`;

  // Profile-as-lens: if a profile is active and has an embedding, re-rank the
  // project's knowledge by cosine similarity to the anchor. Topics still float to
  // the top within the lens, then leaves sorted by similarity.
  let knowledge: KnowledgeRow[];
  let lensApplied = false;
  let lensName: string | null = null;
  const active = readActiveContext();
  if (active) {
    const ctx = db
      .prepare(`SELECT * FROM contexts WHERE id = ?`)
      .get(active.context_id) as ContextRow | undefined;
    const anchorVec =
      ctx && ctx.embedding ? (JSON.parse(ctx.embedding) as number[]) : null;
    if (anchorVec) {
      const all = db
        .prepare(
          `SELECT * FROM knowledge
           WHERE project = ? OR project = ''`
        )
        .all(project) as KnowledgeRow[];
      const scored = all.map((row) => {
        const sim = row.embedding
          ? cosine(anchorVec, JSON.parse(row.embedding) as number[])
          : -1;
        return { row, sim };
      });
      scored.sort((a, b) => {
        const aTopic = a.row.type === "topic" ? 0 : 1;
        const bTopic = b.row.type === "topic" ? 0 : 1;
        if (aTopic !== bTopic) return aTopic - bTopic;
        return b.sim - a.sim;
      });
      knowledge = scored.slice(0, knowledgeLimit).map((s) => s.row);
      lensApplied = true;
      lensName = ctx!.name;
    } else {
      knowledge = db
        .prepare(
          `SELECT * FROM knowledge
           WHERE project = ? OR project = ''
           ORDER BY ${defaultOrder}
           LIMIT ?`
        )
        .all(project, knowledgeLimit) as KnowledgeRow[];
    }
  } else {
    knowledge = db
      .prepare(
        `SELECT * FROM knowledge
         WHERE project = ? OR project = ''
         ORDER BY ${defaultOrder}
         LIMIT ?`
      )
      .all(project, knowledgeLimit) as KnowledgeRow[];
  }

  const { count: annotatedCount } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM file_roles WHERE project = ? OR project = ''`
    )
    .get(project) as { count: number };

  const lines: string[] = [`## Context for: ${project || "(global)"}`, ""];

  if (sessions.length > 0) {
    lines.push("### Recent sessions");
    for (const s of sessions) {
      const outcome = s.outcome ? ` [${s.outcome}]` : "";
      lines.push(`- **${s.created_at.slice(0, 10)}**${outcome}: ${s.summary}`);
      if (s.task && s.task !== s.summary) lines.push(`  Task: ${s.task}`);
    }
    lines.push("");
  } else {
    lines.push("_No sessions logged yet for this project._\n");
  }

  if (knowledge.length > 0) {
    lines.push(
      lensApplied
        ? `### Knowledge base (lens: ${lensName})`
        : "### Knowledge base"
    );
    for (const k of knowledge) {
      const tags = k.tags ? (JSON.parse(k.tags) as string[]).join(", ") : "";
      lines.push(
        `- **[${k.id}] ${k.type.toUpperCase()}**: ${k.title}${tags ? ` (${tags})` : ""}`
      );
      const preview = k.content.split("\n")[0].slice(0, 120);
      lines.push(`  ${preview}${k.content.length > 120 ? "…" : ""}`);
      const links = getLinksFor(k.id);
      if (links.length) {
        lines.push(
          `  Links: ${links.map((l) => `[${l.id}]${l.kind !== "related" ? `(${l.kind})` : ""}`).join(" ")}`
        );
      }
    }
    lines.push("");
    lines.push("Use `claudit search <query>` to find specific items, or reference by [id].");
  } else {
    lines.push("_No knowledge stored yet. Use `claudit add` to build the knowledge base._");
  }

  lines.push("");
  lines.push(
    `**${annotatedCount}** files annotated. Use \`claudit map\` to see the full structure.`
  );

  return {
    text: lines.join("\n"),
    json: {
      project,
      sessions: sessions.map((s) => ({
        id: s.id,
        created_at: s.created_at,
        task: s.task,
        summary: s.summary,
        outcome: s.outcome,
      })),
      knowledge: knowledge.map((k) => ({
        id: k.id,
        type: k.type,
        title: k.title,
        tags: k.tags ? JSON.parse(k.tags) : [],
      })),
      annotated_count: annotatedCount,
      lens: lensApplied ? lensName : null,
    },
  };
}
