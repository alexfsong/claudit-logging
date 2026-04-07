# claudit — Local Optimization Suite for Claude Code

MCP server that gives Claude Code a persistent, project-aware knowledge base.
Maximizes token efficiency by replacing file exploration with accumulated knowledge.

## Architecture

```
src/
├── index.ts          # MCP server entry, 6 tool registrations
├── db.ts             # SQLite + FTS5 schema (knowledge, sessions, file_roles)
├── embed.ts          # Ollama embeddings — optional, graceful fallback to FTS5
├── project.ts        # Git-based project detection, file tree builder
├── types.ts          # MCP SDK type re-export
├── cli.ts            # claudit CLI (search, list, delete, sessions, map, info)
└── tools/
    ├── searchKnowledge.ts   # FTS5 + cosine re-rank when Ollama available
    ├── addKnowledge.ts      # Insert with async embedding
    ├── getProjectMap.ts     # Annotated file tree
    ├── annotateFile.ts      # Upsert file_roles
    ├── getContext.ts        # Recent sessions + top knowledge
    └── logSession.ts        # Record session outcome
```

## Storage

Single SQLite database at `~/.local/share/claudit/knowledge.db` (override: `$CLAUDIT_DB`).
Tables: `knowledge` (FTS5-indexed), `file_roles`, `sessions`.
No external services required. Ollama enhances semantic search if running.

## Build and run

```bash
npm install
npm run build         # tsc → dist/
npm start             # stdio MCP server
node dist/cli.js info # CLI
```

## MCP configuration (add to Claude Code settings)

```json
{
  "mcpServers": {
    "claudit": {
      "command": "node",
      "args": ["/path/to/claudit-logging/dist/index.js"]
    }
  }
}
```

## The 6 tools

| Tool | When to call |
|---|---|
| `get_context` | **Start of every session** — loads prior work without file reads |
| `search_knowledge` | **Before solving any non-trivial problem** — check if already solved |
| `add_knowledge` | **After solving something** — solution, pattern, gotcha, decision, reference |
| `get_project_map` | **Instead of ls/find** — annotated tree is more informative |
| `annotate_file` | **After reading a significant file** — one-liner for future sessions |
| `log_session` | **End of session** — links outcome + knowledge ids created |

## Knowledge types

- **solution** — how to solve a specific problem in this project
- **pattern** — reusable code convention or idiom
- **gotcha** — something that doesn't work / edge case / trap
- **decision** — architectural choice and its rationale
- **reference** — external doc, API detail, or library note

## Recommended session workflow

**Session start:**
1. Call `get_context` — orients Claude without file reads
2. Call `search_knowledge` with the task description — surfaces prior work
3. Call `get_project_map` if unfamiliar with the codebase structure

**During session:**
- After solving a non-trivial problem: `add_knowledge` (type: solution)
- After reading a key file: `annotate_file`
- After discovering a gotcha or making a decision: `add_knowledge`

**Session end:**
- Call `log_session` with summary, outcome, and ids of knowledge created

## CLI commands

```bash
claudit search "migrations test database"   # search without Claude
claudit list --type solution                # list all solutions
claudit sessions                            # recent sessions for this project
claudit map                                 # file tree for current project
claudit info                                # DB stats
claudit delete <id>                         # remove stale item
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDIT_DB` | `~/.local/share/claudit/knowledge.db` | SQLite DB path |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |

## Design decisions

- **SQLite + FTS5** over ChromaDB — zero external services, FTS5 is fast enough for thousands of items
- **Cosine similarity in JS** for re-ranking when Ollama available — sufficient at this scale
- **Project auto-detection** via `git remote get-url origin` — stable ID across machines
- **Global knowledge** (project = '') — patterns that apply everywhere
- **CLI mirrors MCP** — manage knowledge base directly without a Claude session
- **No Obsidian dependency** — plain SQLite, no vault path required

## Known limitations

- Semantic search requires Ollama running with `nomic-embed-text` pulled
- FTS5 porter stemmer may miss highly technical terms — use multiple query phrasings
- `get_project_map` ignores `node_modules`, `.git`, `dist`, `build` by default
