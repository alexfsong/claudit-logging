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
      type        TEXT NOT NULL CHECK(type IN ('solution','pattern','gotcha','decision','reference')),
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

    CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project);
    CREATE INDEX IF NOT EXISTS idx_knowledge_type    ON knowledge(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_file_roles_project ON file_roles(project);
  `);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeRow {
  id: number;
  type: "solution" | "pattern" | "gotcha" | "decision" | "reference";
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
