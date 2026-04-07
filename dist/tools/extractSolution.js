import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { embedNote } from "../embedding/pipeline.js";
export async function extractSolution(vaultPath, args) {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const slug = slugify(args.problem);
    const filename = `${dateStr}-${slug}.md`;
    const dir = path.join(vaultPath, "solutions", args.area);
    await fs.ensureDir(dir);
    const notePath = path.join(dir, filename);
    const content = `---
date: ${dateStr}
area: ${args.area}
source_session: "${args.source_session}"
problem: "${escapeYaml(args.problem)}"
solution: "${escapeYaml(args.solution)}"
confidence: ${args.confidence ?? "medium"}
still_valid: true
semantic_tags: []
---

## Problem in detail
${args.problem}

## Solution in detail
${args.solution_detail ?? args.solution}

## Code / artifacts
${args.code ?? "<!-- paste working code, configs, or key outputs here -->"}

## Caveats & context
${args.caveats ?? "<!-- conditions this solution depends on -->"}
`;
    await fs.writeFile(notePath, content);
    // Link solution back to source session
    const relPath = path.relative(vaultPath, notePath);
    await linkSolutionToSession(vaultPath, args.source_session, relPath);
    // Embed
    embedNote(vaultPath, relPath).catch(console.error);
    return {
        content: [{ type: "text", text: `Solution extracted: ${relPath}` }],
    };
}
async function linkSolutionToSession(vaultPath, sessionPath, solutionPath) {
    const absPath = path.join(vaultPath, sessionPath);
    if (!(await fs.pathExists(absPath)))
        return;
    const raw = await fs.readFile(absPath, "utf-8");
    const { data: fm, content: body } = matter(raw);
    if (!Array.isArray(fm.solutions_extracted))
        fm.solutions_extracted = [];
    fm.solutions_extracted.push(solutionPath);
    await fs.writeFile(absPath, matter.stringify(body, fm));
}
function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
}
function escapeYaml(str) {
    return str.replace(/"/g, '\\"').replace(/\n/g, " ");
}
