#!/usr/bin/env node
/**
 * claudit CLI — manage the knowledge base from the terminal.
 *
 * Usage:
 *   claudit search <query>          — search knowledge base
 *   claudit list [--project <p>]    — list all knowledge items
 *   claudit delete <id>             — delete a knowledge item
 *   claudit sessions [--project <p>] — list recent sessions
 *   claudit map [dir]               — print project file tree
 *   claudit info                    — show DB path and stats
 */

import { getDb, getDbPath, type KnowledgeRow, type SessionRow } from "./db.js";
import { detectProject, buildTree, renderTree, gitRoot } from "./project.js";

const [, , command, ...rest] = process.argv;

function printUsage() {
  console.log(`claudit <command> [options]

Commands:
  search <query>              Search knowledge base
  list [--type <type>]        List knowledge items
  delete <id>                 Delete a knowledge item
  sessions                    List recent sessions
  map [dir]                   Print annotated project map
  info                        Show DB stats
`);
}

function formatRow(row: KnowledgeRow): string {
  const tags = row.tags ? `[${(JSON.parse(row.tags) as string[]).join(", ")}]` : "";
  const date = row.created_at.slice(0, 10);
  return [
    `  #${row.id} ${row.type.toUpperCase().padEnd(9)} ${date}  ${row.title} ${tags}`,
    row.content
      .split("\n")
      .slice(0, 2)
      .map((l) => `           ${l}`)
      .join("\n"),
  ].join("\n");
}

async function main() {
  const db = getDb();

  switch (command) {
    case "search": {
      const query = rest.join(" ");
      if (!query) { printUsage(); process.exit(1); }

      const ftsQuery = query
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => `"${w}"`)
        .join(" OR ");

      const rows = db
        .prepare(
          `SELECT k.* FROM knowledge k
           JOIN knowledge_fts ON knowledge_fts.rowid = k.id
           WHERE knowledge_fts MATCH ?
           ORDER BY bm25(knowledge_fts)
           LIMIT 20`
        )
        .all(ftsQuery || '""') as KnowledgeRow[];

      if (!rows.length) {
        console.log("No results found.");
      } else {
        console.log(`\nResults for "${query}":\n`);
        for (const row of rows) {
          console.log(formatRow(row));
          if (row.code) {
            const snippet = row.code.split("\n").slice(0, 5).join("\n");
            console.log(snippet.split("\n").map(l => `           ${l}`).join("\n"));
          }
          console.log();
        }
      }
      break;
    }

    case "list": {
      const typeIdx = rest.indexOf("--type");
      const typeFilter = typeIdx !== -1 ? rest[typeIdx + 1] : null;
      const project = detectProject();

      const rows = db
        .prepare(
          `SELECT * FROM knowledge
           WHERE (project = ? OR project = '')
           ${typeFilter ? "AND type = ?" : ""}
           ORDER BY created_at DESC
           LIMIT 100`
        )
        .all(...([project, ...(typeFilter ? [typeFilter] : [])] as string[])) as KnowledgeRow[];

      if (!rows.length) {
        console.log("No knowledge stored yet. Use add_knowledge in a Claude session.");
      } else {
        console.log(`\nKnowledge base (${rows.length} items, project: ${project || "global"}):\n`);
        for (const row of rows) console.log(formatRow(row) + "\n");
      }
      break;
    }

    case "delete": {
      const id = parseInt(rest[0], 10);
      if (isNaN(id)) { console.error("Usage: claudit delete <id>"); process.exit(1); }
      const row = db.prepare("SELECT title FROM knowledge WHERE id = ?").get(id) as { title: string } | undefined;
      if (!row) { console.error(`No item with id ${id}`); process.exit(1); }
      db.prepare("DELETE FROM knowledge WHERE id = ?").run(id);
      console.log(`Deleted #${id}: ${row.title}`);
      break;
    }

    case "sessions": {
      const project = detectProject();
      const rows = db
        .prepare(
          `SELECT * FROM sessions WHERE project = ? ORDER BY created_at DESC LIMIT 20`
        )
        .all(project) as SessionRow[];

      if (!rows.length) {
        console.log("No sessions logged for this project yet.");
      } else {
        console.log(`\nRecent sessions (${project || "global"}):\n`);
        for (const s of rows) {
          const outcome = s.outcome ? ` [${s.outcome}]` : "";
          console.log(`  ${s.created_at.slice(0, 10)}${outcome}: ${s.summary}`);
          if (s.task) console.log(`    Task: ${s.task}`);
          console.log();
        }
      }
      break;
    }

    case "map": {
      const dir = rest[0] ?? gitRoot();
      const project = detectProject(dir);
      const roleRows = db
        .prepare(`SELECT path, role FROM file_roles WHERE project = ? OR project = ''`)
        .all(project) as { path: string; role: string }[];
      const roles = new Map(roleRows.map((r) => [r.path, r.role]));
      const tree = buildTree(dir, 4);
      const rendered = renderTree(tree, roles, dir);
      console.log(`\n${dir.split("/").pop()}/\n${rendered}`);
      break;
    }

    case "info": {
      const dbPath = getDbPath();
      const { knowledgeCount } = db.prepare("SELECT COUNT(*) AS knowledgeCount FROM knowledge").get() as { knowledgeCount: number };
      const { sessionCount } = db.prepare("SELECT COUNT(*) AS sessionCount FROM sessions").get() as { sessionCount: number };
      const { fileCount } = db.prepare("SELECT COUNT(*) AS fileCount FROM file_roles").get() as { fileCount: number };
      const { projectCount } = db.prepare("SELECT COUNT(DISTINCT project) AS projectCount FROM knowledge").get() as { projectCount: number };
      console.log(`\nclaudit database: ${dbPath}`);
      console.log(`  Knowledge items : ${knowledgeCount}`);
      console.log(`  Sessions        : ${sessionCount}`);
      console.log(`  Annotated files : ${fileCount}`);
      console.log(`  Projects        : ${projectCount}`);
      break;
    }

    default:
      printUsage();
      if (command) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
