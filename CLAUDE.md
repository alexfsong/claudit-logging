# claudit — Local Optimization Suite for Claude Code

A pure CLI tool that gives Claude Code (or any other tool that can run shell
commands) a persistent, project-aware knowledge base. Maximizes token efficiency
by replacing file exploration with accumulated knowledge.

**No MCP server.** No daemon. One binary, one SQLite file. Claude calls `claudit`
via its Bash tool exactly the way you would in your terminal.

## Architecture

```
src/
├── cli.ts              # argv dispatcher — thin, calls into commands/
├── db.ts               # SQLite + FTS5 schema (knowledge, sessions, file_roles, contexts)
├── embed.ts            # Ollama embeddings — optional, graceful fallback to FTS5
├── project.ts          # Git-based project detection, file tree builder
├── activeContext.ts    # Active profile state file (~/.local/share/claudit/active-context.json)
└── commands/
    ├── types.ts        # CommandResult { text, json }
    ├── add.ts          # claudit add <type> ...
    ├── search.ts       # claudit search "<query>"
    ├── list.ts         # claudit list
    ├── delete.ts       # claudit delete <id>
    ├── annotate.ts     # claudit annotate <path> "<role>"
    ├── log.ts          # claudit log "<summary>" --outcome ...
    ├── sessions.ts     # claudit sessions
    ├── map.ts          # claudit map
    ├── info.ts         # claudit info
    ├── recall.ts       # claudit recall   (was get_context)
    └── profile.ts      # claudit profile {list,set,show,current,clear,drift}
```

Each command file is a pure function returning `{ text, json }`. `cli.ts` parses
argv, calls the command, prints `text` (default) or `JSON.stringify(json)` if
`--json` is passed.

## Storage

Single SQLite database at `~/.local/share/claudit/knowledge.db` (override:
`$CLAUDIT_DB`). Tables: `knowledge` (FTS5-indexed), `file_roles`, `sessions`,
`contexts`. No external services required. Ollama enhances semantic search
and powers drift detection if running.

Active context profile state lives in `~/.local/share/claudit/active-context.json`
(override: `$CLAUDIT_ACTIVE_FILE`). The `claudit run` wrapper writes it on
session start and removes it on session end. Read by the status line and by
`claudit profile drift`.

## Install

```bash
npm install
npm run build                      # tsc → dist/
ln -sf "$PWD/dist/cli.js" ~/.local/bin/claudit  # or wherever your bin dir is
chmod +x dist/cli.js
claudit info                       # verify
```

(`npm link` works too if you have write access to your global node_modules.)

## Commands

| Command | When to use |
|---|---|
| `claudit run [-- claude-args...]` | **Launch a session** — picks profile, spawns claude, logs on exit |
| `claudit recall` | **Start of every session** — loads prior sessions + top knowledge |
| `claudit search "<query>"` | **Before solving any non-trivial problem** — check if already solved |
| `claudit add <type> --title ... --content ...` | **After solving something** |
| `claudit map [dir]` | **Instead of ls/find** — annotated tree |
| `claudit annotate <path> "<role>"` | **After reading a significant file** |
| `claudit log "<summary>" --outcome ...` | **End of session** |
| `claudit profile list` | See saved focus profiles for the project |
| `claudit profile set <name> [-d "..."]` | Activate (or create) a focus profile |
| `claudit profile delete <name>` | Remove a saved profile (and clear it if active) |
| `claudit profile drift "<task>"` | Check if a task has drifted from the active focus |
| `claudit link <from> <to> [--kind ...]` | Cross-link two knowledge items |
| `claudit unlink <from> <to>` | Remove a link |
| `claudit topic <id>` | Print a topic synthesis with all `parent`-linked children inline |
| `claudit lint` | Health check — duplicates, orphans, stale topics, singleton tags |

### Knowledge types

- `solution` — how to solve a specific problem in this project
- `pattern` — reusable code convention or idiom
- `gotcha` — something that doesn't work / edge case / trap
- `decision` — architectural choice and its rationale
- `reference` — external doc, API detail, or library note
- `topic` — LLM-maintained synthesis page rolling up many leaves; children are
  attached via `claudit link <leaf> <topic> --kind parent`

### Cross-links and topics (wiki model)

Knowledge items are nodes in a graph, not isolated facts. Links are typed and
directional: `related` (default), `supersedes` (use for dedupe), `contradicts`
(flag for review), `parent` (child → topic). When `claudit add` finds items
above 0.75 cosine similarity to the new item, it prints them as link
suggestions — non-blocking, you decide whether to call `claudit link`.

`claudit search` and `claudit recall` print each item's link neighborhood inline,
so following the graph is one fetch, not many. `claudit topic <id>` returns the
whole subtree (synthesis + every child) in one shot — read this before opening
individual leaves.

### Profile-as-lens (not silo)

Profiles do **not** scope knowledge — knowledge is keyed by project. When a
profile is active and Ollama is up, `claudit recall` re-ranks the project's
knowledge by cosine similarity to the active profile's anchor. Same items, new
order. A solution added under one profile automatically surfaces under another
when relevant. Profiles are queries, not folders.

### Global flags

- `--json` — emit machine-readable JSON instead of human text
- `--project P` — override project auto-detection
- `--cwd D` — override working directory (used for project detection)
- `--type T` — filter by knowledge type
- `--limit N` — result limit

## Recommended session workflow

**Launch:** `claudit run` (or `claudit run --profile <name> -- <claude-args...>`).
The wrapper picks a profile interactively (or uses `--profile`), then spawns
`claude`. On exit it prompts for a session log.

**During session (inside claude):**
- `claudit recall` — orient yourself without file reads
- `claudit search "<task description>"` — surface prior work
- `claudit map` if unfamiliar with the codebase structure
- After solving a non-trivial problem: `claudit add solution --title "..." --content "..."`
- After reading a key file: `claudit annotate src/foo.ts "what it does"`
- After discovering a gotcha or making a decision: `claudit add gotcha|decision ...`
- If the user pivots to something unrelated: `claudit profile drift "<new task>"`

**Session end:** handled by the wrapper — it prompts for summary and outcome.

## Context profiles

A profile is a named focus area within a project (e.g. `mcp-rewrite`,
`cli-refactor`, `bug-triage`). Each has a description that serves as the
**drift anchor** — a semantic baseline against which `claudit profile drift`
compares incoming tasks.

The active profile is shown in the Claude Code status line and is enforced at
session start by the `claudit run` wrapper (interactive picker if `--profile`
is not provided).

```bash
claudit profile set claudit-rewrite -d "Rewrite claudit from MCP to pure CLI"
claudit profile drift "fix the dist/ build output"          # → on-topic
claudit profile drift "deploy the production database"     # → DRIFT
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDIT_DB` | `~/.local/share/claudit/knowledge.db` | SQLite DB path |
| `CLAUDIT_ACTIVE_FILE` | `~/.local/share/claudit/active-context.json` | Active profile state |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `OLLAMA_CHAT_MODEL` | `llama3` | Chat model (session summary generation) |

## Design decisions

- **Pure CLI, no MCP.** Universal interop (cron, shell aliases, other AI tools),
  reproducible from a transcript, no protocol coupling, single source of truth.
- **SQLite + FTS5** over ChromaDB — zero external services, FTS5 is fast enough
  for thousands of items.
- **Cosine similarity in JS** for re-ranking and drift detection when Ollama
  available — sufficient at this scale.
- **Project auto-detection** via `git remote get-url origin` — stable ID across
  machines and clones.
- **Global knowledge** (project = '') — patterns that apply everywhere.
- **`{text, json}` command results** — humans get formatted output, scripts
  (and Claude, via `--json`) get structured data.
- **Drift anchor = profile description** — the user knows what they're working
  on; let them name it once at session start, then compare every new task
  against that anchor instead of guessing from the prompt history.

## Known limitations

- Semantic search and drift detection require Ollama running with `nomic-embed-text` pulled
- FTS5 porter stemmer may miss highly technical terms — use multiple query phrasings
- `claudit map` ignores `node_modules`, `.git`, `dist`, `build` by default
- Each `claudit run` session gets its own state file (`active-context-<uuid>.json`)
  via `CLAUDIT_ACTIVE_FILE`, so concurrent sessions don't collide. The status
  line reads the global fallback file and may show "none" when only session-scoped
  files exist.
