import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { embedNote } from "../embedding/pipeline.js";

export async function updateSession(vaultPath: string, args: any) {
  const absPath = path.join(vaultPath, args.session_path);
  if (!(await fs.pathExists(absPath))) {
    return { content: [{ type: "text", text: `Session not found: ${args.session_path}` }], isError: true };
  }

  const raw = await fs.readFile(absPath, "utf-8");
  const { data: fm, content: body } = matter(raw);

  if (args.rating !== undefined) fm.rating = args.rating;
  if (args.gaps_noticed !== undefined) fm.gaps_noticed = args.gaps_noticed;

  let updatedBody = body;
  if (args.what_worked) updatedBody = replaceSection(updatedBody, "What worked", args.what_worked);
  if (args.what_didnt) updatedBody = replaceSection(updatedBody, "What didn't", args.what_didnt);
  if (args.follow_up) updatedBody = replaceSection(updatedBody, "Follow-up needed", args.follow_up);

  // Rebuild the file
  const rebuilt = matter.stringify(updatedBody, fm);
  await fs.writeFile(absPath, rebuilt);

  // Re-embed with updated content
  embedNote(vaultPath, args.session_path).catch(console.error);

  // If rated >= 4, suggest extracting a solution
  const suggestion =
    args.rating >= 4
      ? "\n\nThis session rated 4+. Consider calling extract_solution if a concrete problem was resolved."
      : "";

  return {
    content: [{ type: "text", text: `Session updated: ${args.session_path}${suggestion}` }],
  };
}

function replaceSection(body: string, heading: string, content: string): string {
  const pattern = new RegExp(`(## ${heading}\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");
  if (pattern.test(body)) {
    return body.replace(pattern, `$1${content}\n`);
  }
  return body + `\n## ${heading}\n${content}\n`;
}
