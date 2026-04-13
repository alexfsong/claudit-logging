/**
 * `claudit delete` — remove a knowledge item by id.
 */

import type { CommandResult } from "./types.js";
import { getDb } from "../db.js";

export function deleteKnowledge(args: { id: number }): CommandResult {
  const db = getDb();
  const row = db
    .prepare("SELECT title FROM knowledge WHERE id = ?")
    .get(args.id) as { title: string } | undefined;

  if (!row) {
    throw new Error(`No knowledge item with id ${args.id}`);
  }

  db.prepare("DELETE FROM knowledge WHERE id = ?").run(args.id);

  return {
    text: `Deleted #${args.id}: ${row.title}`,
    json: { id: args.id, title: row.title, deleted: true },
  };
}
