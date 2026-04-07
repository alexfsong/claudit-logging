import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { chromaQuery } from "../embedding/pipeline.js";
export async function loadContext(vaultPath, args) {
    const { context_id } = args;
    const contextPath = resolveContextPath(vaultPath, context_id);
    if (!(await fs.pathExists(contextPath))) {
        return {
            content: [{ type: "text", text: `Context not found: ${context_id}. Use list_contexts to see available profiles.` }],
            isError: true,
        };
    }
    const raw = await fs.readFile(contextPath, "utf-8");
    const { data: fm, content: body } = matter(raw);
    // Extract sections from body
    const sections = parseSections(body);
    // Semantic search for relevant prior work
    const searchQuery = `${fm.title} ${sections.interests ?? ""} ${sections.questions ?? ""}`.trim();
    let priorWork = [];
    try {
        const results = await chromaQuery(searchQuery, 5);
        const seen = new Set();
        for (const r of results) {
            const p = r.metadata.path;
            if (seen.has(p) || p.includes("/contexts/"))
                continue;
            seen.add(p);
            const score = (1 - r.distance).toFixed(2);
            const type = r.metadata.type?.toUpperCase() ?? "NOTE";
            const date = r.metadata.date ?? "";
            const preview = r.document.slice(0, 120).replace(/\n/g, " ").trim();
            priorWork.push(`  [${type}] ${date}  ${preview}...  (relevance: ${score})`);
        }
    }
    catch (_) {
        priorWork = ["  (Search unavailable — is ChromaDB running?)"];
    }
    // Update last_used
    fm.last_used = new Date().toISOString().split("T")[0];
    await fs.writeFile(contextPath, matter.stringify(body, fm));
    const lines = [
        `${"─".repeat(60)}`,
        `CONTEXT LOADED: ${fm.title} (${fm.area})`,
        `${"─".repeat(60)}`,
    ];
    if (sections.interests) {
        lines.push("\nCurrent interests & tastes:");
        lines.push(`  ${sections.interests.replace(/\n/g, "\n  ")}`);
    }
    if (sections.questions) {
        lines.push("\nOpen questions you're exploring:");
        lines.push(`  ${sections.questions.replace(/\n/g, "\n  ")}`);
    }
    if (sections.curator_notes) {
        lines.push("\nCurator notes:");
        lines.push(`  ${sections.curator_notes.replace(/\n/g, "\n  ")}`);
    }
    if (priorWork.length > 0) {
        lines.push("\nMost relevant prior work:");
        lines.push(...priorWork);
    }
    if (sections.loader_instructions) {
        lines.push("\nHow to use this context:");
        lines.push(`  ${sections.loader_instructions.replace(/\n/g, "\n  ")}`);
    }
    lines.push(`${"─".repeat(60)}`);
    return {
        content: [{ type: "text", text: lines.join("\n") }],
    };
}
function parseSections(body) {
    const sections = {};
    const parts = body.split(/^## /m);
    for (const part of parts) {
        const lines = part.trim().split("\n");
        const heading = lines[0].trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "");
        const content = lines
            .slice(1)
            .join("\n")
            .trim()
            .replace(/<!--.*?-->/gs, "")
            .trim();
        if (heading && content)
            sections[heading] = content;
    }
    return sections;
}
export function resolveContextPath(vaultPath, contextId) {
    if (contextId.endsWith(".md"))
        return path.join(vaultPath, "contexts", contextId);
    return path.join(vaultPath, "contexts", contextId + ".md");
}
