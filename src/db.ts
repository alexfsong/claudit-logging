/**
 * SQLite database layer.
 * DB lives at ~/.local/share/claudit/knowledge.db (or $CLAUDIT_DB).
 * Uses FTS5 for full-text search; embeddings stored as JSON blobs for cosine
 * similarity when Ollama is available.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DB_PATH =
  process.env.CLAUDIT_DB ??
  join(homedir(), ".local", "share", "claudit", "knowledge.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = DB_PATH.substring(0, DB_PATH.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

export function getDbPath(): string {
  return DB_PATH;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL CHECK(type IN ('solution','pattern','gotcha','decision','reference','topic')),
      project     TEXT NOT NULL DEFAULT '',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      code        TEXT,
      file_paths  TEXT,       -- JSON array of strings
      tags        TEXT,       -- JSON array of strings
      embedding   TEXT,       -- JSON array of floats (nullable)
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title, content, code, tags,
      content='knowledge',
      content_rowid='id',
      tokenize='porter ascii'
    );

    CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, title, content, code, tags)
        VALUES (new.id, new.title, new.content, COALESCE(new.code,''), COALESCE(new.tags,''));
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, code, tags)
        VALUES ('delete', old.id, old.title, old.content, COALESCE(old.code,''), COALESCE(old.tags,''));
      INSERT INTO knowledge_fts(rowid, title, content, code, tags)
        VALUES (new.id, new.title, new.content, COALESCE(new.code,''), COALESCE(new.tags,''));
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, code, tags)
        VALUES ('delete', old.id, old.title, old.content, COALESCE(old.code,''), COALESCE(old.tags,''));
    END;

    CREATE TABLE IF NOT EXISTS file_roles (
      project     TEXT NOT NULL DEFAULT '',
      path        TEXT NOT NULL,
      role        TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project, path)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project       TEXT NOT NULL DEFAULT '',
      task          TEXT,
      summary       TEXT NOT NULL,
      outcome       TEXT CHECK(outcome IN ('solved','partial','blocked','exploratory')),
      knowledge_ids TEXT,   -- JSON array of knowledge.id values added this session
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_links (
      from_id     INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
      to_id       INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'related' CHECK(kind IN ('related','supersedes','contradicts','parent')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (from_id, to_id, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_links_to ON knowledge_links(to_id);
    CREATE INDEX IF NOT EXISTS idx_links_from ON knowledge_links(from_id);

    CREATE TABLE IF NOT EXISTS contexts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project         TEXT NOT NULL DEFAULT '',
      name            TEXT NOT NULL,
      description     TEXT NOT NULL,    -- the drift anchor: what this context is about
      embedding       TEXT,             -- JSON array of floats (nullable, populated by Ollama)
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at  TEXT,
      UNIQUE(project, name)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project);
    CREATE INDEX IF NOT EXISTS idx_knowledge_type    ON knowledge(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_file_roles_project ON file_roles(project);
    CREATE INDEX IF NOT EXISTS idx_contexts_project  ON contexts(project);
  `);

  // Migration v1: extend knowledge.type CHECK to allow 'topic'.
  // SQLite can't ALTER a CHECK; rebuild the table if user_version < 1.
  const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;
  if (version < 1) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      DROP TRIGGER IF EXISTS knowledge_ai;
      DROP TRIGGER IF EXISTS knowledge_au;
      DROP TRIGGER IF EXISTS knowledge_ad;
      ALTER TABLE knowledge RENAME TO knowledge_old;
      CREATE TABLE knowledge (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL CHECK(type IN ('solution','pattern','gotcha','decision','reference','topic')),
        project     TEXT NOT NULL DEFAULT '',
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        code        TEXT,
        file_paths  TEXT,
        tags        TEXT,
        embedding   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO knowledge SELECT * FROM knowledge_old;
      DROP TABLE knowledge_old;
      CREATE TRIGGER knowledge_ai AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, title, content, code, tags)
          VALUES (new.id, new.title, new.content, COALESCE(new.code,''), COALESCE(new.tags,''));
      END;
      CREATE TRIGGER knowledge_au AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, code, tags)
          VALUES ('delete', old.id, old.title, old.content, COALESCE(old.code,''), COALESCE(old.tags,''));
        INSERT INTO knowledge_fts(rowid, title, content, code, tags)
          VALUES (new.id, new.title, new.content, COALESCE(new.code,''), COALESCE(new.tags,''));
      END;
      CREATE TRIGGER knowledge_ad AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, code, tags)
          VALUES ('delete', old.id, old.title, old.content, COALESCE(old.code,''), COALESCE(old.tags,''));
      END;
      INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild');
      CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project);
      CREATE INDEX IF NOT EXISTS idx_knowledge_type    ON knowledge(type);
      COMMIT;
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 1;
    `);
  }

  // Migration v2: the v1 rebuild left knowledge_links's FK pinned to the
  // (since-dropped) knowledge_old table. Recreate it pointing at knowledge.
  // Safe to drop unconditionally — links are a brand-new feature.
  if (version < 2) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      DROP TABLE IF EXISTS knowledge_links;
      CREATE TABLE knowledge_links (
        from_id     INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        to_id       INTEGER NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL DEFAULT 'related' CHECK(kind IN ('related','supersedes','contradicts','parent')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (from_id, to_id, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_links_to ON knowledge_links(to_id);
      CREATE INDEX IF NOT EXISTS idx_links_from ON knowledge_links(from_id);
      COMMIT;
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 2;
    `);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeRow {
  id: number;
  type: "solution" | "pattern" | "gotcha" | "decision" | "reference" | "topic";
  project: string;
  title: string;
  content: string;
  code: string | null;
  file_paths: string | null;
  tags: string | null;
  embedding: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: number;
  project: string;
  task: string | null;
  summary: string;
  outcome: string | null;
  knowledge_ids: string | null;
  created_at: string;
}

export interface FileRoleRow {
  project: string;
  path: string;
  role: string;
  updated_at: string;
}

export interface KnowledgeLinkRow {
  from_id: number;
  to_id: number;
  kind: "related" | "supersedes" | "contradicts" | "parent";
  created_at: string;
  updated_at: string;
}

export interface ContextRow {
  id: number;
  project: string;
  name: string;
  description: string;
  embedding: string | null;
  created_at: string;
  last_active_at: string | null;
}
