/**
 * `claudit lint` — wiki health check.
 *
 * Read-only pass. Reports:
 *   - duplicates : pairs with cosine sim ≥ DUP_THRESHOLD and not already linked
 *   - orphans    : items with zero links and no parent topic
 *   - stale      : topics whose updated_at < newest child updated_at
 *   - tag drift  : tags used only once (typo candidates)
 *
 * Suggestions only — claudit never auto-mutates.
 */

import type { CommandResult } from "./types.js";
import { getDb, type KnowledgeRow } from "../db.js";
import { cosine } from "../embed.js";
import { detectProject } from "../project.js";

const DUP_THRESHOLD = 0.92;

export function lint(args: { project?: string; cwd?: string }): CommandResult {
  const db = getDb();
  const project = args.project ?? detectProject(args.cwd);

  const items = db
    .prepare(
      `SELECT * FROM knowledge WHERE project = ? OR project = ''`
    )
    .all(project) as KnowledgeRow[];

  // Existing links — used to skip already-linked pairs in dup detection.
  const existingLinks = new Set<string>();
  const linkedIds = new Set<number>();
  const childOf = new Map<number, number[]>(); // topic id -> child ids
  for (const row of db
    .prepare(
      `SELECT from_id, to_id, kind FROM knowledge_links
       WHERE from_id IN (SELECT id FROM knowledge WHERE project = ? OR project = '')`
    )
    .all(project) as { from_id: number; to_id: number; kind: string }[]) {
    existingLinks.add(`${Math.min(row.from_id, row.to_id)}-${Math.max(row.from_id, row.to_id)}`);
    linkedIds.add(row.from_id);
    linkedIds.add(row.to_id);
    if (row.kind === "parent") {
      const arr = childOf.get(row.to_id) ?? [];
      arr.push(row.from_id);
      childOf.set(row.to_id, arr);
    }
  }

  // 1) Duplicate candidates.
  const withVec = items
    .filter((r) => r.embedding)
    .map((r) => ({ row: r, vec: JSON.parse(r.embedding!) as number[] }));
  const duplicates: { a: number; b: number; similarity: number; titles: [string, string] }[] = [];
  for (let i = 0; i < withVec.length; i++) {
    for (let j = i + 1; j < withVec.length; j++) {
      const a = withVec[i].row;
      const b = withVec[j].row;
      const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
      if (existingLinks.has(key)) continue;
      const sim = cosine(withVec[i].vec, withVec[j].vec);
      if (sim >= DUP_THRESHOLD) {
        duplicates.push({ a: a.id, b: b.id, similarity: sim, titles: [a.title, b.title] });
      }
    }
  }
  duplicates.sort((x, y) => y.similarity - x.similarity);

  // 2) Orphans: no links of any kind.
  const orphans = items
    .filter((r) => r.type !== "topic" && !linkedIds.has(r.id))
    .map((r) => ({ id: r.id, type: r.type, title: r.title }));

  // 3) Stale topics: topic.updated_at < max(child.updated_at).
  const stale: { id: number; title: string; topic_updated: string; newest_child: string }[] = [];
  for (const t of items.filter((r) => r.type === "topic")) {
    const childIds = childOf.get(t.id) ?? [];
    if (childIds.length === 0) continue;
    let newest = "";
    for (const cid of childIds) {
      const c = items.find((x) => x.id === cid);
      if (c && c.updated_at > newest) newest = c.updated_at;
    }
    if (newest && newest > t.updated_at) {
      stale.push({ id: t.id, title: t.title, topic_updated: t.updated_at, newest_child: newest });
    }
  }

  // 4) Tag drift: tags used exactly once across the project.
  const tagCounts = new Map<string, number>();
  for (const r of items) {
    if (!r.tags) continue;
    for (const tag of JSON.parse(r.tags) as string[]) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const singletonTags = [...tagCounts.entries()]
    .filter(([, n]) => n === 1)
    .map(([t]) => t)
    .sort();

  // ── Output ─────────────────────────────────────────────────────────────────
  const lines: string[] = [`Lint report for ${project || "(global)"}:`, ""];

  lines.push(`## Duplicate candidates (≥ ${DUP_THRESHOLD})`);
  if (duplicates.length === 0) {
    lines.push("  none");
  } else {
    for (const d of duplicates.slice(0, 20)) {
      lines.push(`  [${d.a}] ↔ [${d.b}]  ${d.similarity.toFixed(3)}`);
      lines.push(`    "${d.titles[0]}"`);
      lines.push(`    "${d.titles[1]}"`);
      lines.push(`    → \`claudit link ${d.a} ${d.b} --kind supersedes\` (or merge manually)`);
    }
  }
  lines.push("");

  lines.push(`## Orphans (no links, no parent topic)`);
  if (orphans.length === 0) {
    lines.push("  none");
  } else {
    for (const o of orphans) {
      lines.push(`  [${o.id}] ${o.type.toUpperCase()}: ${o.title}`);
    }
  }
  lines.push("");

  lines.push(`## Stale topics (children updated after topic)`);
  if (stale.length === 0) {
    lines.push("  none");
  } else {
    for (const s of stale) {
      lines.push(
        `  [${s.id}] ${s.title}  (topic: ${s.topic_updated.slice(0, 10)}, newest child: ${s.newest_child.slice(0, 10)})`
      );
    }
  }
  lines.push("");

  lines.push(`## Singleton tags (typo candidates)`);
  if (singletonTags.length === 0) {
    lines.push("  none");
  } else {
    lines.push(`  ${singletonTags.join(", ")}`);
  }

  return {
    text: lines.join("\n"),
    json: {
      project,
      duplicates,
      orphans,
      stale_topics: stale,
      singleton_tags: singletonTags,
    },
  };
}
