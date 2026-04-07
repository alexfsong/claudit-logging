#!/usr/bin/env node
/**
 * claudit — Local optimization suite for Claude Code.
 * MCP server that gives Claude access to a persistent, project-aware knowledge base.
 *
 * Tools:
 *   search_knowledge  — FTS5 + semantic search over solutions, patterns, gotchas
 *   add_knowledge     — store a solution, pattern, gotcha, decision, or reference
 *   get_project_map   — annotated file tree (replaces manual file exploration)
 *   annotate_file     — set a one-line role description for a file
 *   get_context       — recent sessions + top knowledge for current project
 *   log_session       — record session outcome + links to knowledge created
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { searchKnowledge } from "./tools/searchKnowledge.js";
import { addKnowledge } from "./tools/addKnowledge.js";
import { getProjectMap } from "./tools/getProjectMap.js";
import { annotateFile } from "./tools/annotateFile.js";
import { getContext } from "./tools/getContext.js";
import { logSession } from "./tools/logSession.js";
const server = new Server({ name: "claudit", version: "2.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "search_knowledge",
            description: "Search the persistent knowledge base for solutions, patterns, gotchas, decisions, " +
                "and references relevant to what you're about to work on. Call this BEFORE exploring " +
                "files or attempting to solve a problem — prior solutions may already exist. " +
                "Uses full-text search (always) + semantic re-ranking (when Ollama is available).",
            inputSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Natural language description of what you need",
                    },
                    type: {
                        type: "string",
                        enum: ["solution", "pattern", "gotcha", "decision", "reference"],
                        description: "Filter by knowledge type (optional)",
                    },
                    project: {
                        type: "string",
                        description: "Project identifier override (auto-detected from git remote by default)",
                    },
                    limit: {
                        type: "number",
                        description: "Max results to return (default: 8, max: 20)",
                    },
                },
                required: ["query"],
            },
        },
        {
            name: "add_knowledge",
            description: "Store a piece of knowledge for future sessions. Use this whenever you solve a " +
                "non-trivial problem, discover a project-specific pattern, hit an unexpected gotcha, " +
                "or make an architectural decision. Good knowledge entries save tokens in future sessions.",
            inputSchema: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: ["solution", "pattern", "gotcha", "decision", "reference"],
                        description: "solution=how to solve a specific problem | " +
                            "pattern=reusable code convention | " +
                            "gotcha=trap or edge case | " +
                            "decision=architectural choice + rationale | " +
                            "reference=external doc or API note",
                    },
                    title: {
                        type: "string",
                        description: "Short, searchable title (e.g. 'How to run migrations in test env')",
                    },
                    content: {
                        type: "string",
                        description: "Full explanation — include enough detail to act on without re-reading the source",
                    },
                    code: {
                        type: "string",
                        description: "Code snippet illustrating the solution or pattern (optional)",
                    },
                    file_paths: {
                        type: "array",
                        items: { type: "string" },
                        description: "Relevant file paths (relative to project root)",
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Searchable tags",
                    },
                    project: {
                        type: "string",
                        description: "Project identifier (auto-detected by default). Leave empty for global knowledge.",
                    },
                },
                required: ["type", "title", "content"],
            },
        },
        {
            name: "get_project_map",
            description: "Get an annotated file tree of the project. Annotations show each file's role " +
                "in one line, so you can understand project structure without reading files. " +
                "Much more token-efficient than exploring with ls/find.",
            inputSchema: {
                type: "object",
                properties: {
                    dir: {
                        type: "string",
                        description: "Directory to map (default: git root of current directory)",
                    },
                    max_depth: {
                        type: "number",
                        description: "Max directory depth (default: 4)",
                    },
                },
                required: [],
            },
        },
        {
            name: "annotate_file",
            description: "Attach a one-line role description to a file. These annotations appear in " +
                "get_project_map output and help future sessions understand the codebase without " +
                "reading each file. Call after reading or creating a significant file.",
            inputSchema: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "File path (absolute or relative to cwd)",
                    },
                    role: {
                        type: "string",
                        description: "One-line description of what the file does and exports. " +
                            "E.g. 'JWT middleware, exports requireAuth and requireAdmin decorators'",
                    },
                    project: {
                        type: "string",
                        description: "Project identifier (auto-detected by default)",
                    },
                },
                required: ["path", "role"],
            },
        },
        {
            name: "get_context",
            description: "Load accumulated context for the current project: recent session history and " +
                "top knowledge items. Call at the start of a session to orient yourself without " +
                "spending tokens on file exploration.",
            inputSchema: {
                type: "object",
                properties: {
                    project: {
                        type: "string",
                        description: "Project identifier (auto-detected by default)",
                    },
                    session_limit: {
                        type: "number",
                        description: "Number of recent sessions to show (default: 5)",
                    },
                    knowledge_limit: {
                        type: "number",
                        description: "Number of knowledge items to show (default: 10)",
                    },
                },
                required: [],
            },
        },
        {
            name: "log_session",
            description: "Record what happened in this session. Call before ending a session. " +
                "Captures task, outcome, and links to any knowledge items you created (by id). " +
                "This builds the session history shown by get_context in future sessions.",
            inputSchema: {
                type: "object",
                properties: {
                    summary: {
                        type: "string",
                        description: "2-3 sentence description of what was accomplished",
                    },
                    task: {
                        type: "string",
                        description: "One-line description of what the user asked for",
                    },
                    outcome: {
                        type: "string",
                        enum: ["solved", "partial", "blocked", "exploratory"],
                    },
                    knowledge_ids: {
                        type: "array",
                        items: { type: "number" },
                        description: "IDs of knowledge items created or updated this session",
                    },
                    project: {
                        type: "string",
                        description: "Project identifier (auto-detected by default)",
                    },
                },
                required: ["summary"],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {});
    try {
        switch (name) {
            case "search_knowledge":
                return await searchKnowledge(a);
            case "add_knowledge":
                return await addKnowledge(a);
            case "get_project_map":
                return getProjectMap(a);
            case "annotate_file":
                return annotateFile(a);
            case "get_context":
                return getContext(a);
            case "log_session":
                return logSession(a);
            default:
                return {
                    content: [{ type: "text", text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Error in ${name}: ${msg}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`claudit MCP server running — DB: ${(await import("./db.js")).getDbPath()}`);
}
main().catch(console.error);
