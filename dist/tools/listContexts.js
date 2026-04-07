import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { embedNote } from "../embedding/pipeline.js";
import { resolveContextPath } from "./loadContext.js";
// ---------------------------------------------------------------------------
// listContexts
// ---------------------------------------------------------------------------
export async function listContexts(vaultPath) {
    const contextsDir = path.join(vaultPath, "contexts");
    await fs.ensureDir(contextsDir);
    const files = await walkDir(contextsDir);
    const mdFiles = files.filter((f) => f.endsWith(".md") && !path.basename(f).startsWith("_"));
    const contexts = [];
    for (const file of mdFiles) {
        try {
            const raw = await fs.readFile(file, "utf-8");
            const { data: fm } = matter(raw);
            const relPath = path.relative(path.join(vaultPath, "contexts"), file);
            const id = relPath.replace(/\.md$/, "");
            contexts.push({
                id,
                title: fm.title ?? id,
                type: fm.type ?? "topic",
                area: fm.area ?? "unknown",
                session_count: fm.session_count ?? 0,
                last_used: fm.last_used ?? fm.date ?? "never",
            });
        }
        catch (_) { }
    }
    // Sort by last_used desc
    contexts.sort((a, b) => (b.last_used > a.last_used ? 1 : -1));
    if (contexts.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "No context profiles found. Use create_context to add your first one.",
                },
            ],
        };
    }
    // Group by type
    const technical = contexts.filter((c) => c.type === "technical-project");
    const topics = contexts.filter((c) => c.type !== "technical-project");
    const lines = ["Active contexts:\n"];
    if (technical.length > 0) {
        lines.push("TECHNICAL PROJECTS");
        technical.forEach((c, i) => {
            lines.push(`  [${i + 1}] ${c.title.padEnd(24)} (${c.area})  ${String(c.session_count).padStart(3)} sessions  last: ${c.last_used}`);
            lines.push(`       id: ${c.id}`);
        });
        lines.push("");
    }
    if (topics.length > 0) {
        lines.push("TOPICS");
        topics.forEach((c, i) => {
            lines.push(`  [${technical.length + i + 1}] ${c.title.padEnd(24)} (${c.area})  ${String(c.session_count).padStart(3)} sessions  last: ${c.last_used}`);
            lines.push(`       id: ${c.id}`);
        });
    }
    lines.push('\nTo load: call load_context with the id shown above.');
    return { content: [{ type: "text", text: lines.join("\n") }] };
}
// ---------------------------------------------------------------------------
// createContext
// ---------------------------------------------------------------------------
export async function createContext(vaultPath, args) {
    const subdir = args.type === "technical-project" ? "technical" : "topics";
    const dir = path.join(vaultPath, "contexts", subdir);
    await fs.ensureDir(dir);
    const slug = slugify(args.title);
    const filename = `${slug}.md`;
    const filePath = path.join(dir, filename);
    const id = `${subdir}/${slug}`;
    if (await fs.pathExists(filePath)) {
        return {
            content: [{ type: "text", text: `Context already exists: ${id}` }],
            isError: true,
        };
    }
    const dateStr = new Date().toISOString().split("T")[0];
    const content = `---
title: ${args.title}
type: ${args.type}
area: ${args.area}
status: active
date: ${dateStr}
last_used: ${dateStr}
auto_extracted: false
session_count: 0
---

## Current interests & tastes
${args.initial_interests ?? "<!-- Auto-extracted from sessions, curate freely -->"}

## Open questions I'm exploring
${args.initial_questions ?? "<!-- Things you're genuinely unsure about or researching -->"}

## Curator notes
<!-- Your manual overrides, corrections, and nuance — never auto-overwritten -->

## Context loader instructions
${args.loader_instructions ?? "<!-- How Claude should USE this context — assumptions, skill level, constraints -->"}

## Session history
<!-- Auto-populated by MCP -->
`;
    await fs.writeFile(filePath, content);
    const relPath = path.relative(vaultPath, filePath);
    embedNote(vaultPath, relPath).catch(console.error);
    return {
        content: [
            {
                type: "text",
                text: `Context created: ${id}\n\nLoad it with: load_context("${id}")`,
            },
        ],
    };
}
// ---------------------------------------------------------------------------
// updateContext
// ---------------------------------------------------------------------------
export async function updateContext(vaultPath, args) {
    const { context_id, field, content, mode = "append" } = args;
    const contextPath = resolveContextPath(vaultPath, context_id);
    if (!(await fs.pathExists(contextPath))) {
        return { content: [{ type: "text", text: `Context not found: ${context_id}` }], isError: true };
    }
    const raw = await fs.readFile(contextPath, "utf-8");
    const headingMap = {
        interests: "Current interests & tastes",
        questions: "Open questions I'm exploring",
        curator_notes: "Curator notes",
        loader_instructions: "Context loader instructions",
    };
    const heading = headingMap[field];
    if (!heading) {
        return { content: [{ type: "text", text: `Unknown field: ${field}` }], isError: true };
    }
    let updated;
    if (mode === "replace") {
        const pattern = new RegExp(`(## ${heading}\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");
        updated = raw.replace(pattern, `$1${content}\n`);
    }
    else {
        // append
        updated = raw.replace(new RegExp(`(## ${heading}\\n)`, "m"), `$1${content}\n`);
    }
    await fs.writeFile(contextPath, updated);
    embedNote(vaultPath, path.relative(vaultPath, contextPath)).catch(console.error);
    return { content: [{ type: "text", text: `Context updated: ${field} in ${context_id}` }] };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            files.push(...(await walkDir(full)));
        else
            files.push(full);
    }
    return files;
}
function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
}
