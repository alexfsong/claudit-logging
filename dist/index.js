#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { logSession } from "./tools/logSession.js";
import { updateSession } from "./tools/updateSession.js";
import { extractSolution } from "./tools/extractSolution.js";
import { searchVault } from "./tools/searchVault.js";
import { loadContext } from "./tools/loadContext.js";
import { listContexts } from "./tools/listContexts.js";
import { updateContext } from "./tools/updateContext.js";
import { createContext } from "./tools/createContext.js";
import { extractContextFromSession } from "./tools/extractContextFromSession.js";
import { generateWeeklyReview } from "./tools/generateWeeklyReview.js";
import { reindexVault } from "./tools/reindexVault.js";
const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
    console.error("VAULT_PATH environment variable is required");
    process.exit(1);
}
const server = new Server({ name: "obsidian-tracker", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "log_session",
            description: "Log a Claude session to the Obsidian vault. Call this at the end of a session to record what was discussed, the output type, and key results.",
            inputSchema: {
                type: "object",
                properties: {
                    area: {
                        type: "string",
                        enum: ["work", "personal-projects", "learning", "health", "hobbies"],
                        description: "Life area this session belongs to",
                    },
                    session_type: {
                        type: "string",
                        enum: ["planning", "brainstorming", "code", "research", "writing", "misc"],
                    },
                    output_type: {
                        type: "string",
                        enum: ["code", "brainstorm", "plan", "summary", "draft", "other"],
                    },
                    prompt_intent: {
                        type: "string",
                        description: "What the user was trying to accomplish",
                    },
                    key_output: {
                        type: "string",
                        description: "One-line summary of what Claude produced",
                    },
                    notable_output: {
                        type: "string",
                        description: "The key output content or a description of it",
                    },
                    duration_mins: { type: "number" },
                    project: {
                        type: "string",
                        description: "Project or context name if applicable",
                    },
                    context_id: {
                        type: "string",
                        description: "ID of the context profile loaded for this session",
                    },
                    gaps_noticed: {
                        type: "string",
                        description: "Anything Claude had to ask for or assumed incorrectly",
                    },
                    context_provided: {
                        type: "object",
                        properties: {
                            background: { type: "boolean" },
                            examples: { type: "boolean" },
                            constraints: { type: "boolean" },
                            prior_output: { type: "boolean" },
                        },
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                    },
                },
                required: ["area", "session_type", "output_type", "prompt_intent", "key_output"],
            },
        },
        {
            name: "update_session",
            description: "Update an existing session note — add rating, notes, or follow-up links after you've used the output.",
            inputSchema: {
                type: "object",
                properties: {
                    session_path: { type: "string", description: "Relative path to session note from vault root" },
                    rating: { type: "number", minimum: 1, maximum: 5 },
                    what_worked: { type: "string" },
                    what_didnt: { type: "string" },
                    follow_up: { type: "string" },
                    gaps_noticed: { type: "string" },
                },
                required: ["session_path"],
            },
        },
        {
            name: "extract_solution",
            description: "Extract a reusable solution from a session into a standalone searchable note.",
            inputSchema: {
                type: "object",
                properties: {
                    source_session: { type: "string", description: "Relative path to source session note" },
                    problem: { type: "string", description: "One sentence: what was being solved" },
                    solution: { type: "string", description: "One sentence: what resolved it" },
                    solution_detail: { type: "string", description: "Full solution with code/artifacts if any" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    caveats: { type: "string" },
                    area: { type: "string", enum: ["work", "personal-projects", "learning", "health", "hobbies"] },
                },
                required: ["source_session", "problem", "solution", "area"],
            },
        },
        {
            name: "search_vault",
            description: "Semantic search across all vault content — sessions, solutions, and context profiles. Returns the most relevant prior work for a given query.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Natural language search query" },
                    k: { type: "number", description: "Number of results to return (default: 5)", default: 5 },
                    filter_area: {
                        type: "string",
                        enum: ["work", "personal-projects", "learning", "health", "hobbies"],
                        description: "Optional: restrict search to a specific life area",
                    },
                    filter_type: {
                        type: "string",
                        enum: ["session", "solution", "context"],
                        description: "Optional: restrict to a specific note type",
                    },
                },
                required: ["query"],
            },
        },
        {
            name: "load_context",
            description: "Load a context profile for a topic or project, combined with the most relevant prior sessions and solutions. Use at session start.",
            inputSchema: {
                type: "object",
                properties: {
                    context_id: { type: "string", description: "Context ID from list_contexts" },
                },
                required: ["context_id"],
            },
        },
        {
            name: "list_contexts",
            description: "List all active context profiles for the picker menu. Returns contexts sorted by recency.",
            inputSchema: { type: "object", properties: {} },
        },
        {
            name: "create_context",
            description: "Create a new context profile for a topic or technical project.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    type: { type: "string", enum: ["topic", "technical-project"] },
                    area: { type: "string", enum: ["work", "personal-projects", "learning", "health", "hobbies"] },
                    initial_interests: { type: "string" },
                    initial_questions: { type: "string" },
                    loader_instructions: { type: "string", description: "How Claude should use this context" },
                },
                required: ["title", "type", "area"],
            },
        },
        {
            name: "update_context",
            description: "Update a specific section of a context profile.",
            inputSchema: {
                type: "object",
                properties: {
                    context_id: { type: "string" },
                    field: {
                        type: "string",
                        enum: ["interests", "questions", "curator_notes", "loader_instructions"],
                    },
                    content: { type: "string" },
                    mode: {
                        type: "string",
                        enum: ["replace", "append"],
                        default: "append",
                    },
                },
                required: ["context_id", "field", "content"],
            },
        },
        {
            name: "extract_context_from_session",
            description: "Run Ollama over a session note to extract interests and questions, then merge into the linked context profile.",
            inputSchema: {
                type: "object",
                properties: {
                    session_path: { type: "string" },
                    context_id: { type: "string" },
                },
                required: ["session_path", "context_id"],
            },
        },
        {
            name: "generate_weekly_review",
            description: "Generate a weekly review note by aggregating sessions and running Ollama analysis.",
            inputSchema: {
                type: "object",
                properties: {
                    week_offset: {
                        type: "number",
                        description: "0 = current week, 1 = last week (default: 0)",
                        default: 0,
                    },
                },
            },
        },
        {
            name: "reindex_vault",
            description: "Rebuild the ChromaDB vector index from scratch. Run if search results seem stale or after bulk vault changes.",
            inputSchema: { type: "object", properties: {} },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "log_session": return await logSession(VAULT_PATH, args);
            case "update_session": return await updateSession(VAULT_PATH, args);
            case "extract_solution": return await extractSolution(VAULT_PATH, args);
            case "search_vault": return await searchVault(VAULT_PATH, args);
            case "load_context": return await loadContext(VAULT_PATH, args);
            case "list_contexts": return await listContexts(VAULT_PATH);
            case "create_context": return await createContext(VAULT_PATH, args);
            case "update_context": return await updateContext(VAULT_PATH, args);
            case "extract_context_from_session":
                return await extractContextFromSession(VAULT_PATH, args);
            case "generate_weekly_review":
                return await generateWeeklyReview(VAULT_PATH, args);
            case "reindex_vault": return await reindexVault(VAULT_PATH);
            default:
                return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
        }
    }
    catch (err) {
        return {
            content: [{ type: "text", text: `Error in ${name}: ${err.message}` }],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Claude Obsidian MCP server running");
}
main().catch(console.error);
