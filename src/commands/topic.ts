/**
 * `claudit topic <id>` — print a topic synthesis with all parent-linked children inline.
 *
 * A topic is a knowledge row with type='topic' that rolls up many leaves. Children
 * are stored as `parent`-kind links pointing INTO the topic
 * (i.e. knowledge_links.from_id = leaf, to_id = topic, kind = 'parent').
 *
 * One fetch returns the whole subtree so Claude doesn't have to chase ids.
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";

export function topic(args: { id: number }): CommandResult {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM knowledge WHERE id = ?`)
    .get(args.id) as KnowledgeRow | undefined;
  if (!row) throw new Error(`No knowledge item with id ${args.id}`);
  if (row.type !== "topic") {
    throw new Error(`[${args.id}] is a ${row.type}, not a topic. Use \`claudit search\` instead.`);
  }

  const children = db
    .prepare(
      `SELECT k.* FROM knowledge k
       JOIN knowledge_links l ON l.from_id = k.id
       WHERE l.to_id = ? AND l.kind = 'parent'
       ORDER BY k.type, k.created_at`
    )
    .all(args.id) as KnowledgeRow[];

  const lines: string[] = [
    `# [${row.id}] TOPIC: ${row.title}`,
    `_${row.created_at.slice(0, 10)} · updated ${row.updated_at.slice(0, 10)}_`,
    "",
    row.content,
    "",
    `## Children (${children.length})`,
    "",
  ];

  if (children.length === 0) {
    lines.push("_No children linked yet. Use `claudit link <leaf-id> <topic-id> --kind parent`._");
  } else {
    for (const c of children) {
      lines.push(`### [${c.id}] ${c.type.toUpperCase()}: ${c.title}`);
      lines.push(c.content);
      if (c.code) {
        lines.push("```");
        lines.push(c.code);
        lines.push("```");
      }
      lines.push("");
    }
  }

  return {
    text: lines.join("\n"),
    json: {
      id: row.id,
      title: row.title,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
      children: children.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        content: c.content,
        code: c.code,
      })),
    },
  };
}
