#!/usr/bin/env node
// Run this once to scaffold your Obsidian vault structure
// Usage: node setup-vault.js /path/to/your/vault

import fs from "fs";
import path from "path";

const VAULT_PATH = process.argv[2];
if (!VAULT_PATH) {
  console.error("Usage: node setup-vault.js /path/to/vault");
  process.exit(1);
}

const dirs = [
  "sessions/work",
  "sessions/personal-projects",
  "sessions/learning",
  "sessions/health",
  "sessions/hobbies",
  "solutions/work",
  "solutions/personal-projects",
  "solutions/learning",
  "solutions/health",
  "solutions/hobbies",
  "contexts/technical",
  "contexts/topics",
  "patterns/weekly-reviews",
  "templates",
  "_meta/_chroma",
];

for (const dir of dirs) {
  fs.mkdirSync(path.join(VAULT_PATH, dir), { recursive: true });
  console.log(`Created: ${dir}`);
}

// Session template
fs.writeFileSync(
  path.join(VAULT_PATH, "templates/session.md"),
  `---
date: {{date}}
area: 
project: ""
context_id: ""
session_type: 
output_type: 
duration_mins: null
model: claude-sonnet-4-6
rating: null
context_provided:
  background: false
  examples: false
  constraints: false
  prior_output: false
key_output: ""
gaps_noticed: ""
solutions_extracted: []
semantic_tags: []
tags: []
---

## Prompt intent

## Notable output

## What worked

## What didn't

## Follow-up needed
`
);

// Context template
fs.writeFileSync(
  path.join(VAULT_PATH, "templates/context.md"),
  `---
title: 
type: topic
area: 
status: active
date: {{date}}
last_used: {{date}}
auto_extracted: false
session_count: 0
---

## Current interests & tastes

## Open questions I'm exploring

## Curator notes

## Context loader instructions

## Session history
`
);

// Weekly review template
fs.writeFileSync(
  path.join(VAULT_PATH, "templates/weekly-review.md"),
  `---
week: 
start_date: 
end_date: 
total_sessions: 0
avg_rating: 
areas: []
---

## Area breakdown

## Top projects this week

## Recurring workflows spotted

## Context you kept leaving out

## Suggested automations

## Questions worth exploring

## One thing to change next week
`
);

// Dataview dashboard
fs.writeFileSync(
  path.join(VAULT_PATH, "_meta/dashboard.md"),
  `# Claude usage dashboard

## Sessions this month

\`\`\`dataview
TABLE area, session_type, output_type, rating, key_output
FROM "sessions"
WHERE date >= date(today) - dur(30d)
SORT date DESC
\`\`\`

## Context gaps — what you skip by area

\`\`\`dataviewjs
const pages = dv.pages('"sessions"');
const areas = [...new Set(pages.map(p => p.area).filter(Boolean))];

const rows = areas.map(area => {
  const s = pages.filter(p => p.area === area);
  const n = s.length;
  if (n === 0) return null;
  const gap = field => {
    const missing = s.filter(p => p.context_provided && !p.context_provided[field]).length;
    return \`\${Math.round(missing/n*100)}%\`;
  };
  return [area, n, gap('background'), gap('examples'), gap('constraints'), gap('prior_output')];
}).filter(Boolean);

dv.table(
  ["Area", "Sessions", "Missing: background", "Missing: examples", "Missing: constraints", "Missing: prior output"],
  rows
);
\`\`\`

## Low-rated sessions — find failure patterns

\`\`\`dataview
TABLE date, area, project, gaps_noticed, key_output
FROM "sessions"
WHERE rating <= 2 AND rating != null
SORT date DESC
\`\`\`

## Solutions library

\`\`\`dataview
TABLE area, problem, confidence, still_valid
FROM "solutions"
WHERE still_valid = true
SORT date DESC
\`\`\`

## Active contexts

\`\`\`dataview
TABLE type, area, session_count, last_used
FROM "contexts"
WHERE status = "active"
SORT last_used DESC
\`\`\`

## Projects by session count and rating

\`\`\`dataviewjs
const pages = dv.pages('"sessions"').filter(p => p.project && p.project !== "");
const projects = [...new Set(pages.map(p => p.project))];

const rows = projects.map(proj => {
  const s = pages.filter(p => p.project === proj);
  const ratings = s.filter(p => p.rating != null).map(p => p.rating);
  const avg = ratings.length > 0 ? (ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1) : "—";
  return [proj, s.length, avg, s[s.length-1]?.date ?? ""];
}).sort((a,b) => b[1]-a[1]);

dv.table(["Project", "Sessions", "Avg rating", "Last active"], rows);
\`\`\`
`
);

// Gitignore for chroma data
fs.writeFileSync(
  path.join(VAULT_PATH, ".gitignore"),
  `_meta/_chroma/
.obsidian/
`
);

console.log("\nVault scaffolded. Next steps:");
console.log("1. Open the vault folder in Obsidian");
console.log("2. Install plugins: Dataview, Templater");
console.log("3. Install and run ChromaDB: pip install chromadb && chroma run --path ./_meta/_chroma");
console.log("4. Pull Ollama models: ollama pull nomic-embed-text && ollama pull llama3.2");
console.log("5. Build and configure the MCP server (see README.md)");
