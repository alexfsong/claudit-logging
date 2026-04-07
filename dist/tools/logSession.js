import fs from "fs-extra";
import path from "path";
import { embedNote, ollamaGenerate } from "../embedding/pipeline.js";
export async function logSession(vaultPath, args) {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().slice(0, 5).replace(":", "-");
    const slug = slugify(args.key_output || args.prompt_intent || "session");
    const filename = `${dateStr}-${timeStr}-${slug}.md`;
    const dir = path.join(vaultPath, "sessions", args.area);
    await fs.ensureDir(dir);
    const notePath = path.join(dir, filename);
    // Generate semantic tags via Ollama (non-blocking best-effort)
    let semanticTags = [];
    try {
        const tagPrompt = `Given this session summary, generate 4-6 concept-level tags.
Return ONLY a JSON array of strings. No preamble, no markdown.
Example: ["voice leading", "chord substitution", "jazz harmony"]

Session intent: ${args.prompt_intent}
Key output: ${args.key_output}
Output type: ${args.output_type}
Area: ${args.area}`;
        const raw = await ollamaGenerate(tagPrompt);
        const clean = raw.replace(/```json|```/g, "").trim();
        semanticTags = JSON.parse(clean);
    }
    catch (_) {
        // tags are optional — don't fail session logging
    }
    const contextProvided = args.context_provided ?? {
        background: false,
        examples: false,
        constraints: false,
        prior_output: false,
    };
    const frontmatter = `---
date: ${dateStr}
area: ${args.area}
project: "${args.project ?? ""}"
context_id: "${args.context_id ?? ""}"
session_type: ${args.session_type}
output_type: ${args.output_type}
duration_mins: ${args.duration_mins ?? null}
model: ${process.env.MODEL_NAME ?? "claude-sonnet-4-6"}
rating: null
context_provided:
  background: ${contextProvided.background ?? false}
  examples: ${contextProvided.examples ?? false}
  constraints: ${contextProvided.constraints ?? false}
  prior_output: ${contextProvided.prior_output ?? false}
key_output: "${escapeYaml(args.key_output ?? "")}"
gaps_noticed: "${escapeYaml(args.gaps_noticed ?? "")}"
solutions_extracted: []
semantic_tags: [${semanticTags.map((t) => `"${t}"`).join(", ")}]
tags: [${(args.tags ?? []).map((t) => `"${t}"`).join(", ")}]
---`;
    const body = `
## Prompt intent
${args.prompt_intent ?? ""}

## Notable output
${args.notable_output ?? ""}

## What worked
<!-- Fill after using the output -->

## What didn't
<!-- Fill after using the output -->

## Follow-up needed
<!-- Any next steps or open questions -->
`;
    await fs.writeFile(notePath, frontmatter + "\n" + body);
    // Embed asynchronously — don't block the response
    const relPath = path.relative(vaultPath, notePath);
    embedNote(vaultPath, relPath).catch(console.error);
    // Update context session count if linked
    if (args.context_id) {
        updateContextSessionCount(vaultPath, args.context_id, relPath).catch(console.error);
        extractContextFromSessionAsync(vaultPath, relPath, args.context_id).catch(console.error);
    }
    return {
        content: [
            {
                type: "text",
                text: `Session logged: ${relPath}\n\nRemember to update the rating after you've used the output by calling update_session with the path above.`,
            },
        ],
    };
}
async function updateContextSessionCount(vaultPath, contextId, sessionPath) {
    const contextPath = resolveContextPath(vaultPath, contextId);
    if (!(await fs.pathExists(contextPath)))
        return;
    const raw = await fs.readFile(contextPath, "utf-8");
    const updated = raw.replace(/session_count: (\d+)/, (_, n) => `session_count: ${parseInt(n) + 1}`);
    // Append session link
    const sessionLine = `- [[${sessionPath}]]`;
    const withSession = updated.includes("## Session history")
        ? updated.replace("## Session history", `## Session history\n${sessionLine}`)
        : updated + `\n## Session history\n${sessionLine}\n`;
    await fs.writeFile(contextPath, withSession);
}
async function extractContextFromSessionAsync(vaultPath, sessionPath, contextId) {
    // Small delay to let the session file settle
    await new Promise((r) => setTimeout(r, 2000));
    const { extractContextFromSession } = await import("./extractContextFromSession.js");
    await extractContextFromSession(vaultPath, { session_path: sessionPath, context_id: contextId });
}
export function resolveContextPath(vaultPath, contextId) {
    // contextId is either a relative path or a slug like "topics/music"
    if (contextId.endsWith(".md")) {
        return path.join(vaultPath, "contexts", contextId);
    }
    return path.join(vaultPath, "contexts", contextId + ".md");
}
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40);
}
function escapeYaml(str) {
    return str.replace(/"/g, '\\"').replace(/\n/g, " ");
}
