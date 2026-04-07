# claude-obsidian-mcp

MCP server that logs Claude sessions to an Obsidian vault with semantic search via ChromaDB and local LLM analysis via Ollama.

---

## Prerequisites

- Node.js 18+
- Python 3.9+
- [Ollama](https://ollama.com) installed and running
- [ChromaDB](https://docs.trychroma.com)
- [Obsidian](https://obsidian.md) with Dataview plugin

---

## Installation

### 1. Build the MCP server

```bash
cd claude-obsidian-mcp
npm install
npm run build
```

### 2. Scaffold the vault

```bash
node setup-vault.js /path/to/your/obsidian/vault
```

### 3. Pull Ollama models

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
```

### 4. Start ChromaDB

```bash
chroma run --path /path/to/your/vault/_meta/_chroma
```

Keep this running in a background terminal. On macOS you can use a launch agent or just a persistent tmux session.

### 5. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "obsidian-tracker": {
      "command": "node",
      "args": ["/absolute/path/to/claude-obsidian-mcp/dist/index.js"],
      "env": {
        "VAULT_PATH": "/absolute/path/to/your/vault",
        "OLLAMA_URL": "http://localhost:11434",
        "OLLAMA_MODEL": "llama3.2",
        "OLLAMA_EMBED_MODEL": "nomic-embed-text",
        "CHROMA_URL": "http://localhost:8000"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### 6. Verify

In a new Claude session, ask: "Call list_contexts". If the MCP server is connected you'll get a response (empty list is fine on first run).

---

## Daily usage

### Start a session with context
```
Call list_contexts
```
Pick a topic or project by id, then:
```
Call load_context with context_id "topics/music"
```

### End a session
```
Call log_session with area "hobbies", session_type "research", output_type "summary",
prompt_intent "...", key_output "..."
```

### Rate after using the output
```
Call update_session with session_path "sessions/hobbies/2026-03-20-...", rating 4
```

### Extract a solution
```
Call extract_solution with source_session "sessions/work/...", problem "...", solution "...", area "work"
```

### Weekly review
```
Call generate_weekly_review
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_PATH` | (required) | Absolute path to Obsidian vault |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2` | Model for weekly reviews and tag generation |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model for embeddings |
| `CHROMA_URL` | `http://localhost:8000` | ChromaDB server URL |
| `MODEL_NAME` | `claude-sonnet-4-6` | Logged in session frontmatter |

---

## Troubleshooting

**`list_contexts` returns nothing / MCP not connecting**
- Check Claude Desktop was fully restarted after config change
- Verify the path in `args` is absolute and the `dist/index.js` file exists
- Check Console.app (macOS) for MCP server errors

**`search_vault` returns no results**
- Confirm ChromaDB is running: `curl http://localhost:8000/api/v1/heartbeat`
- Run `reindex_vault` to rebuild the index from scratch

**Ollama calls failing**
- Confirm Ollama is running: `ollama list`
- Test embed model: `curl http://localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"test"}'`

**TypeScript build errors**
- Ensure all files from `src/tools/` are present including `updateContext.ts` and `createContext.ts`
- Run `npm install` before `npm run build`

---

## Rebuilding the search index

If notes get out of sync with ChromaDB (after bulk edits, or if search feels stale):

```
Call reindex_vault
```

Or run ChromaDB fresh:
```bash
rm -rf /path/to/vault/_meta/_chroma
chroma run --path /path/to/vault/_meta/_chroma
# then call reindex_vault in Claude
```
