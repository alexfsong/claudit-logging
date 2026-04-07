import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { ollamaGenerate } from "../embedding/pipeline.js";

export async function generateWeeklyReview(vaultPath: string, args: any) {
  const weekOffset = args.week_offset ?? 0;
  const { startDate, endDate, weekLabel } = getWeekRange(weekOffset);

  // Collect all sessions in the date range
  const sessions = await collectSessionsInRange(vaultPath, startDate, endDate);

  if (sessions.length === 0) {
    return {
      content: [{ type: "text", text: `No sessions found for week ${weekLabel}.` }],
    };
  }

  // Build structured summary for Ollama
  const sessionData = sessions.map((s) => ({
    date: s.fm.date,
    area: s.fm.area,
    session_type: s.fm.session_type,
    output_type: s.fm.output_type,
    rating: s.fm.rating,
    key_output: s.fm.key_output,
    gaps_noticed: s.fm.gaps_noticed,
    context_provided: s.fm.context_provided,
    semantic_tags: s.fm.semantic_tags ?? [],
    project: s.fm.project,
  }));

  // Compute stats locally — don't ask Ollama to do math
  const stats = computeStats(sessionData);

  const prompt = `You are analyzing a week of Claude AI usage for a developer. 
Return ONLY valid JSON. No preamble, no markdown fences.

Session data:
${JSON.stringify(sessionData, null, 2)}

Stats:
${JSON.stringify(stats, null, 2)}

Return this exact structure:
{
  "area_breakdown": "2-3 sentences summarizing how time was split across life areas",
  "top_projects": ["project name or topic that had most activity"],
  "recurring_workflows": ["only list if a pattern appears in 3+ sessions, otherwise empty"],
  "context_gaps": "which context_provided fields were most often false, and what that suggests",
  "suggested_automations": ["concrete workflow worth scripting or templating"],
  "questions_worth_exploring": ["interesting follow-up from this week's sessions"],
  "one_thing_to_change": "single most impactful behavioral change for next week"
}`;

  let review: Record<string, any> = {};
  try {
    const raw = await ollamaGenerate(prompt);
    const clean = raw.replace(/```json|```/g, "").trim();
    review = JSON.parse(clean);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Ollama review generation failed: ${err}. Is Ollama running?` }],
      isError: true,
    };
  }

  // Write the review note
  const reviewDir = path.join(vaultPath, "patterns", "weekly-reviews");
  await fs.ensureDir(reviewDir);
  const reviewPath = path.join(reviewDir, `${weekLabel}.md`);

  const ratingValues = sessionData.filter((s) => s.rating != null).map((s) => Number(s.rating));
  const avgRating = ratingValues.length > 0
    ? (ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length).toFixed(1)
    : "n/a";

  const noteContent = `---
week: ${weekLabel}
start_date: ${startDate}
end_date: ${endDate}
total_sessions: ${sessions.length}
avg_rating: ${avgRating}
areas: [${[...new Set(sessionData.map((s) => s.area))].join(", ")}]
---

## Area breakdown
${review.area_breakdown ?? ""}

## Top projects this week
${(review.top_projects ?? []).map((p: string) => `- ${p}`).join("\n")}

## Recurring workflows spotted
${(review.recurring_workflows ?? []).length > 0
  ? (review.recurring_workflows as string[]).map((w) => `- ${w}`).join("\n")
  : "_None identified this week — patterns emerge after 3+ similar sessions._"}

## Context you kept leaving out
${review.context_gaps ?? ""}

## Suggested automations
${(review.suggested_automations ?? []).map((a: string) => `- ${a}`).join("\n")}

## Questions worth exploring
${(review.questions_worth_exploring ?? []).map((q: string) => `- ${q}`).join("\n")}

## One thing to change next week
${review.one_thing_to_change ?? ""}

---
*Generated ${new Date().toISOString().split("T")[0]} from ${sessions.length} sessions*
`;

  await fs.writeFile(reviewPath, noteContent);

  return {
    content: [
      {
        type: "text",
        text: `Weekly review generated: patterns/weekly-reviews/${weekLabel}.md\n\n${sessions.length} sessions analyzed. Avg rating: ${avgRating}`,
      },
    ],
  };
}

function getWeekRange(offset: number): { startDate: string; endDate: string; weekLabel: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) - offset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const year = monday.getFullYear();
  const week = getISOWeek(monday);
  const label = `${year}-W${String(week).padStart(2, "0")}`;

  return {
    startDate: monday.toISOString().split("T")[0],
    endDate: sunday.toISOString().split("T")[0],
    weekLabel: label,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

async function collectSessionsInRange(
  vaultPath: string,
  startDate: string,
  endDate: string
): Promise<Array<{ fm: Record<string, any>; path: string }>> {
  const sessionsDir = path.join(vaultPath, "sessions");
  if (!(await fs.pathExists(sessionsDir))) return [];

  const files = await walkDir(sessionsDir);
  const sessions = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(file, "utf-8");
      const { data: fm } = matter(raw);
      if (fm.date >= startDate && fm.date <= endDate) {
        sessions.push({ fm, path: path.relative(vaultPath, file) });
      }
    } catch (_) {}
  }

  return sessions.sort((a, b) => (a.fm.date > b.fm.date ? 1 : -1));
}

function computeStats(sessions: any[]) {
  const byArea: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const contextGaps = { background: 0, examples: 0, constraints: 0, prior_output: 0 };
  let totalRated = 0;

  for (const s of sessions) {
    byArea[s.area] = (byArea[s.area] ?? 0) + 1;
    byType[s.output_type] = (byType[s.output_type] ?? 0) + 1;
    if (s.rating != null) totalRated++;
    if (s.context_provided) {
      for (const key of Object.keys(contextGaps) as Array<keyof typeof contextGaps>) {
        if (!s.context_provided[key]) contextGaps[key]++;
      }
    }
  }

  return { by_area: byArea, by_output_type: byType, context_gaps: contextGaps, total_sessions: sessions.length, total_rated: totalRated };
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walkDir(full)));
    else files.push(full);
  }
  return files;
}
