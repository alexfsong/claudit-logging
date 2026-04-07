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
export {};
