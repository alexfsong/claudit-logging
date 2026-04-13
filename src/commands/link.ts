/**
 * `claudit link` / `claudit unlink` — manage cross-links between knowledge items.
 *
 * Links are directional and typed. Kinds:
 *   related      — generic association (default)
 *   supersedes   — from_id replaces to_id (use for dedupe / fix-ups)
 *   contradicts  — from_id disagrees with to_id (flag for human review)
 *   parent       — to_id is a parent topic synthesizing from_id
 *
 * Linking is the de-silo primitive: it turns isolated leaves into a graph
 * navigable from any entry point.
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";

export type LinkKind = "related" | "supersedes" | "contradicts" | "parent";

const KINDS: LinkKind[] = ["related", "supersedes", "contradicts", "parent"];

export function isLinkKind(s: string): s is LinkKind {
  return (KINDS as string[]).includes(s);
}

function requireKnowledge(id: number): KnowledgeRow {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM knowledge WHERE id = ?`).get(id) as
    | KnowledgeRow
    | undefined;
  if (!row) throw new Error(`No knowledge item with id ${id}`);
  return row;
}

export function link(args: {
  from: number;
  to: number;
  kind?: LinkKind;
}): CommandResult {
  if (args.from === args.to) throw new Error("Cannot link an item to itself");
  const kind: LinkKind = args.kind ?? "related";
  const db = getDb();
  const fromRow = requireKnowledge(args.from);
  const toRow = requireKnowledge(args.to);

  db.prepare(
    `INSERT OR REPLACE INTO knowledge_links (from_id, to_id, kind, created_at, updated_at)
     VALUES (?, ?, ?, COALESCE((SELECT created_at FROM knowledge_links WHERE from_id=? AND to_id=? AND kind=?), datetime('now')), datetime('now'))`
  ).run(args.from, args.to, kind, args.from, args.to, kind);

  // Touch updated_at on both endpoints so a UI can detect change.
  db.prepare(`UPDATE knowledge SET updated_at = datetime('now') WHERE id IN (?, ?)`).run(
    args.from,
    args.to
  );

  return {
    text: `Linked [${fromRow.id}] "${fromRow.title}" → [${toRow.id}] "${toRow.title}" (${kind})`,
    json: { from: args.from, to: args.to, kind },
  };
}

export function unlink(args: {
  from: number;
  to: number;
  kind?: LinkKind;
}): CommandResult {
  const db = getDb();
  let result;
  if (args.kind) {
    result = db
      .prepare(`DELETE FROM knowledge_links WHERE from_id=? AND to_id=? AND kind=?`)
      .run(args.from, args.to, args.kind);
  } else {
    result = db
      .prepare(`DELETE FROM knowledge_links WHERE from_id=? AND to_id=?`)
      .run(args.from, args.to);
  }
  if (result.changes === 0) {
    return {
      text: `No link found between ${args.from} and ${args.to}${args.kind ? ` (kind=${args.kind})` : ""}`,
      json: { removed: 0 },
    };
  }
  db.prepare(`UPDATE knowledge SET updated_at = datetime('now') WHERE id IN (?, ?)`).run(
    args.from,
    args.to
  );
  return {
    text: `Removed ${result.changes} link(s) between ${args.from} and ${args.to}`,
    json: { removed: result.changes },
  };
}

/**
 * Returns ids linked to the given knowledge id (in either direction), with kind.
 * Used by `search` and `recall` to surface neighborhoods inline.
 */
export function getLinksFor(id: number): { id: number; kind: LinkKind; dir: "out" | "in" }[] {
  const db = getDb();
  const out = db
    .prepare(`SELECT to_id AS id, kind FROM knowledge_links WHERE from_id = ?`)
    .all(id) as { id: number; kind: LinkKind }[];
  const incoming = db
    .prepare(`SELECT from_id AS id, kind FROM knowledge_links WHERE to_id = ?`)
    .all(id) as { id: number; kind: LinkKind }[];
  return [
    ...out.map((r) => ({ ...r, dir: "out" as const })),
    ...incoming.map((r) => ({ ...r, dir: "in" as const })),
  ];
}
