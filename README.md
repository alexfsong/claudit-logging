# claudit

A pure CLI tool that gives Claude Code (or any other tool that can run shell
commands) a persistent, project-aware knowledge base. Replaces per-session file
exploration with accumulated knowledge — solutions, patterns, gotchas, decisions,
and named focus profiles that survive across sessions.

**No MCP server. No daemon.** One binary, one SQLite file. Claude calls
`claudit` via its Bash tool exactly the way you would in your terminal.

**Stack:** SQLite + FTS5. No external services required. Ollama optional for
semantic re-ranking and drift detection.

---

## Prerequisites

- Node.js 18+
- Ollama (optional — enables semantic re-ranking and `profile drift`)

---

## Installation

```bash
npm install
npm run build
ln -sf "$PWD/dist/cli.js" ~/.local/bin/claudit
chmod +x dist/cli.js
claudit info                       # verify
```

The SQLite database is created automatically on first use at
`~/.local/share/claudit/knowledge.db`.

If `~/.local/bin` isn't on your `PATH`, symlink to whichever bin dir is —
`/usr/local/bin`, `~/bin`, etc. `npm link` works too if you have write access
to your global `node_modules`.

---

## Commands

| Command | When to call |
|---|---|
| `claudit recall` | **Start of every session** — loads recent sessions + top knowledge |
| `claudit search "<query>"` | **Before solving any non-trivial problem** |
| `claudit add <type> --title "..." --content "..."` | **After solving something** |
| `claudit map [dir]` | **Instead of ls/find** — annotated file tree |
| `claudit annotate <path> "<role>"` | **After reading a significant file** |
| `claudit log "<summary>" --outcome ...` | **End of every session** |
| `claudit profile list` | See saved focus profiles for the project |
| `claudit profile set <name> [-d "..."]` | Activate (or create) a focus profile |
| `claudit profile drift "<task>"` | Check if a task has drifted from active focus |
| `claudit link <from> <to> [--kind ...]` | Cross-link two knowledge items |
| `claudit unlink <from> <to>` | Remove a link |
| `claudit topic <id>` | Print a topic synthesis with all `parent`-linked children |
| `claudit lint` | Health check (duplicates, orphans, stale topics, tag drift) |

### Knowledge types

- **solution** — how to solve a specific problem in this project
- **pattern** — reusable code convention or idiom
- **gotcha** — something that doesn't work / edge case / trap
- **decision** — architectural choice and its rationale
- **reference** — external doc, API detail, or library note
- **topic** — LLM-maintained synthesis page rolling up many leaves (link
  children with `claudit link <leaf> <topic> --kind parent`)

### Wiki model: links, topics, lens

claudit treats knowledge as a graph, not a flat list. A few primitives borrowed
from Karpathy's "LLM Wiki" pattern fight fragmentation:

- **Cross-links** (`claudit link`) — typed and directional (`related`,
  `supersedes`, `contradicts`, `parent`). After every `add`, claudit prints up
  to 3 high-similarity items as suggestions; you decide whether to link them.
  `search` and `recall` print each item's link neighborhood inline, so
  following the graph never costs an extra fetch.
- **Topic pages** (`claudit add topic ...` + `claudit topic <id>`) — a
  knowledge item with `type=topic` is a synthesis hub. Attach children via
  `--kind parent`. `claudit topic <id>` returns the synthesis plus every child
  in one shot — Claude lands on the rollup, not 15 leaves.
- **Profile-as-lens** — profiles do NOT scope knowledge. When a profile is
  active and Ollama is up, `claudit recall` re-ranks the project's knowledge
  by cosine similarity to the active anchor. Same items, new order. A solution
  added under one profile auto-surfaces under another when relevant.
- **Lint** (`claudit lint`) — read-only health check: duplicate candidates
  above 0.92 cosine, orphans with no links, topics that are stale relative to
  their children, tags used only once.

### Global flags

- `--json` — emit machine-readable JSON instead of human text
- `--project P` — override project auto-detection
- `--cwd D` — override working directory (used for project detection)
- `--type T` — filter by knowledge type
- `--limit N` — result limit

---

## Session workflow (for Claude)

**Session start:**
1. `claudit recall` — orient yourself without file reads
2. `claudit profile show` — verify which focus area is active
3. `claudit search "<task description>"` — surface prior work

**During session:**
- After solving a non-trivial problem → `claudit add solution ...`
- After reading a key file → `claudit annotate src/foo.ts "what it does"`
- After a gotcha or decision → `claudit add gotcha|decision ...`
- If user pivots to something unrelated → `claudit profile drift "<task>"`,
  then `claudit log` + `claudit profile set <new>`

**Session end:**
- `claudit log "<summary>" --outcome solved --ids 1,2,3`

---

## Context profiles

A profile is a named focus area within a project (e.g. `mcp-rewrite`,
`cli-refactor`, `bug-triage`). Each has a description that serves as the
**drift anchor** — a semantic baseline against which `claudit profile drift`
compares incoming tasks.

```bash
claudit profile set claudit-rewrite -d "Rewrite claudit from MCP to pure CLI"
claudit profile show
claudit profile drift "fix the dist/ build output"        # → on-topic
claudit profile drift "deploy the production database"  # → DRIFT
```

The active profile is stored in `~/.local/share/claudit/active-context.json` and
can be surfaced in your Claude Code status line:

```json
{
  "statusLine": {
    "type": "command",
    "command": "input=$(cat); f=~/.local/share/claudit/active-context.json; ctx=$([ -f \"$f\" ] && jq -r '.name' \"$f\" 2>/dev/null || echo none); model=$(echo \"$input\" | jq -r '.model.display_name // \"unknown\"'); echo \"ctx: $ctx | $model\""
  }
}
```

A `UserPromptSubmit` hook can also nag at session start if no profile is set —
see `CLAUDE.md` for the full pattern.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDIT_DB` | `~/.local/share/claudit/knowledge.db` | SQLite DB path |
| `CLAUDIT_ACTIVE_FILE` | `~/.local/share/claudit/active-context.json` | Active profile state |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |

---

## Project auto-detection

Project identity is derived from `git remote get-url origin` in the current
directory. This gives a stable, machine-independent identifier. Knowledge stored
with no project set (empty string) is **global** — it appears in searches for
every project.

---

## Troubleshooting

**`claudit: command not found`**
- Verify the symlink: `ls -l $(which claudit)` should point at `dist/cli.js`
- `chmod +x dist/cli.js`
- `~/.local/bin` must be on `PATH`

**Semantic search / drift not working**
- Ollama is optional; FTS5 search still works without it
- To enable: `ollama pull nomic-embed-text` and `ollama serve`
- Test: `curl http://localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"test"}'`

**`claudit search` returns no results**
- Try broader terms — FTS5 uses porter stemming
- `claudit list` to confirm items exist
- `claudit info` for DB stats

**Build errors**
- `npm install` before `npm run build`
- Requires Node.js 18+

---

## Why pure CLI instead of MCP?

- **Universal interop.** Same tool in Claude Code, cron, shell aliases, other
  AI tools, your scripts. MCP locks you into Claude Code.
- **Inspectable and reproducible.** Every Claude action is a `Bash` tool call
  you can read in the transcript and re-run in your terminal.
- **Composable.** Pipelines work: `claudit search ... | jq ... | claudit add ...`.
- **No protocol coupling.** MCP is a moving target; CLI is forever.
- **Single source of truth.** No duplication between MCP tool wrappers and CLI
  subcommands.
- **Cold start is invisible.** ~200ms node startup vs. 5-30s model turns.
