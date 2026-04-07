import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { ollamaGenerate } from "../embedding/pipeline.js";
import { resolveContextPath } from "./loadContext.js";

export async function extractContextFromSession(vaultPath: string, args: any) {
  const { session_path, context_id } = args;

  const sessionAbs = path.join(vaultPath, session_path);
  if (!(await fs.pathExists(sessionAbs))) {
    return { content: [{ type: "text", text: `Session not found: ${session_path}` }], isError: true };
  }

  const contextPath = resolveContextPath(vaultPath, context_id);
  if (!(await fs.pathExists(contextPath))) {
    return { content: [{ type: "text", text: `Context not found: ${context_id}` }], isError: true };
  }

  const sessionRaw = await fs.readFile(sessionAbs, "utf-8");
  const { data: fm, content: body } = matter(sessionRaw);

  // Build a compact summary for Ollama
  const sessionSummary = [
    `Intent: ${fm.prompt_intent ?? ""}`,
    `Key output: ${fm.key_output ?? ""}`,
    `Output type: ${fm.output_type ?? ""}`,
    `Gaps noticed: ${fm.gaps_noticed ?? ""}`,
    `Body excerpt: ${body.slice(0, 500)}`,
  ].join("\n");

  const prompt = `Analyze this session summary and extract meaningful context.
Return ONLY valid JSON with no preamble or markdown fences.

Session:
${sessionSummary}

Return this exact structure:
{
  "interests": ["specific interest or preference revealed, if any"],
  "questions": ["open question that emerged, if any"]
}

Rules:
- Only extract what is explicitly present. Do not invent.
- If nothing is present for a field, return an empty array.
- Each item should be a complete, standalone sentence or phrase.
- Maximum 3 items per field.`;

  let extracted: { interests: string[]; questions: string[] } = { interests: [], questions: [] };
  try {
    const raw = await ollamaGenerate(prompt);
    const clean = raw.replace(/```json|```/g, "").trim();
    extracted = JSON.parse(clean);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Ollama extraction failed: ${err}. Is Ollama running?` }],
      isError: true,
    };
  }

  if (extracted.interests.length === 0 && extracted.questions.length === 0) {
    return {
      content: [{ type: "text", text: "No new context extracted from session." }],
    };
  }

  // Merge into context profile — append to auto-extracted sections
  const contextRaw = await fs.readFile(contextPath, "utf-8");
  let updated = contextRaw;

  if (extracted.interests.length > 0) {
    const newItems = extracted.interests.map((i) => `- ${i} *(auto, ${new Date().toISOString().split("T")[0]})*`).join("\n");
    updated = appendToSection(updated, "Current interests & tastes", newItems);
  }

  if (extracted.questions.length > 0) {
    const newItems = extracted.questions.map((q) => `- ${q} *(auto, ${new Date().toISOString().split("T")[0]})*`).join("\n");
    updated = appendToSection(updated, "Open questions I'm exploring", newItems);
  }

  await fs.writeFile(contextPath, updated);

  const summary = [
    `Context updated for: ${context_id}`,
    extracted.interests.length > 0 ? `\nNew interests:\n${extracted.interests.map((i) => `  - ${i}`).join("\n")}` : "",
    extracted.questions.length > 0 ? `\nNew questions:\n${extracted.questions.map((q) => `  - ${q}`).join("\n")}` : "",
  ].join("");

  return { content: [{ type: "text", text: summary }] };
}

function appendToSection(content: string, heading: string, newContent: string): string {
  const pattern = new RegExp(`(## ${heading}\\n)`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `$1${newContent}\n`);
  }
  return content + `\n## ${heading}\n${newContent}\n`;
}
