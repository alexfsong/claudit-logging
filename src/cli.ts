#!/usr/bin/env node
/**
 * claudit — local optimization suite for Claude Code.
 *
 * Pure CLI: every operation is a subcommand. No MCP server, no daemon. Claude
 * (or any other tool) calls these via shell. State lives in a single SQLite file.
 *
 * Usage:
 *   claudit recall                          Load recent sessions + top knowledge
 *   claudit search "<query>" [--type T]     Search the knowledge base
 *   claudit add <type> --title "..." --content "..." [--code ...] [--tags a,b]
 *   claudit list [--type T]                 List knowledge items
 *   claudit delete <id>                     Delete a knowledge item
 *   claudit annotate <path> "<role>"        Attach a one-line role to a file
 *   claudit log "<summary>" [--task ...] [--outcome solved|partial|blocked|exploratory] [--ids 1,2]
 *   claudit sessions                        Recent sessions for current project
 *   claudit map [dir]                       Annotated file tree
 *   claudit info                            DB stats
 *   claudit profile list                    List context profiles
 *   claudit profile set <name> [-d "..."]   Activate (or create) a profile
 *   claudit profile show                    Show active profile
 *   claudit profile current                 Print active profile name (status line)
 *   claudit profile clear                   Clear active profile
 *   claudit profile drift "<task>"          Drift check vs active profile anchor
 *
 * Global flags:
 *   --json        Emit machine-readable JSON instead of human text
 *   --project P   Override project auto-detection
 *   --cwd D       Override working directory (used for project detection)
 */

import type { CommandResult } from "./commands/types.js";
import { addKnowledge, type KnowledgeType } from "./commands/add.js";
import { search } from "./commands/search.js";
import { list } from "./commands/list.js";
import { deleteKnowledge } from "./commands/delete.js";
import { sessions } from "./commands/sessions.js";
import { map } from "./commands/map.js";
import { annotate } from "./commands/annotate.js";
import { logSession, type Outcome } from "./commands/log.js";
import { info } from "./commands/info.js";
import { recall } from "./commands/recall.js";
import { link, unlink, isLinkKind, type LinkKind } from "./commands/link.js";
import { topic } from "./commands/topic.js";
import { lint } from "./commands/lint.js";
import {
  profileList,
  profileSet,
  profileShow,
  profileCurrent,
  profileClear,
  profileDrift,
  profileDelete,
} from "./commands/profile.js";
import { run } from "./commands/run.js";

// ── Tiny argv parser ─────────────────────────────────────────────────────────

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
  passthrough: string[];
}

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const passthrough: string[] = [];
  let passthroughMode = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--" && !passthroughMode) {
      passthroughMode = true;
      continue;
    }
    if (passthroughMode) {
      passthrough.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, passthrough };
}

function flagStr(p: Parsed, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p.flags[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function flagInt(p: Parsed, ...keys: string[]): number | undefined {
  const s = flagStr(p, ...keys);
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}

function flagList(p: Parsed, ...keys: string[]): string[] | undefined {
  const s = flagStr(p, ...keys);
  if (s === undefined) return undefined;
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function flagIntList(p: Parsed, ...keys: string[]): number[] | undefined {
  const xs = flagList(p, ...keys);
  if (!xs) return undefined;
  return xs.map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));
}

// ── Output ───────────────────────────────────────────────────────────────────

function emit(result: CommandResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result.json, null, 2));
  } else {
    console.log(result.text);
  }
}

function printUsage(): void {
  console.log(`claudit <command> [args] [flags]

Commands:
  run [-- claude-args...]         Launch claude with managed profile + session log
  recall                         Load recent sessions + top knowledge for project
  search "<query>"               FTS5 + semantic search of knowledge base
  add <type>                     Store knowledge (solution|pattern|gotcha|decision|reference|topic)
  list                           List knowledge items
  delete <id>                    Delete a knowledge item
  link <from> <to>               Cross-link two knowledge items (--kind related|supersedes|contradicts|parent)
  unlink <from> <to>             Remove a link
  topic <id>                     Print topic synthesis with parent-linked children inline
  lint                           Health check: dupes, orphans, stale topics, tag drift
  annotate <path> "<role>"       Attach a one-line role description to a file
  log "<summary>"                Record session outcome
  sessions                       Recent sessions for current project
  map [dir]                      Annotated file tree
  info                           DB stats
  profile <subcommand>           Manage context profiles
                                   list | set <name> [-d DESC] | show | current | clear | delete <name> | drift "<task>"

Flags:
  --json                         Machine-readable JSON output
  --project P                    Override project auto-detection
  --cwd D                        Override working directory
  --type T                       Filter by knowledge type
  --limit N                      Result limit
  --title "..."                  (add) title
  --content "..."                (add) content
  --code "..."                   (add) code snippet
  --tags a,b,c                   (add) tags
  --files a,b                    (add) related file paths
  --task "..."                   (log) task description
  --outcome solved|partial|blocked|exploratory
  --ids 1,2,3                    (log) knowledge ids created this session
  -d "..."                       (profile set) description for new profile
  --profile <name>               (run) profile to activate
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printUsage();
    return;
  }

  const p = parse(rest);
  const json = !!p.flags.json;
  const cwd = flagStr(p, "cwd");
  const project = flagStr(p, "project");

  switch (cmd) {
    case "run": {
      if (p.flags.help || p.flags.h) {
        console.log(`claudit run [flags] [-- claude-args...]

Flags:
  --profile <name>   Profile to activate (interactive picker if omitted)
  -d "<desc>"        Description (creates the profile if it doesn't exist)
  --help             Show this help`);
        return;
      }
      const code = await run({
        profile: flagStr(p, "profile", "p"),
        description: flagStr(p, "d", "description"),
        passthrough: p.passthrough,
        cwd,
      });
      process.exit(code);
    }

    case "recall": {
      emit(
        recall({
          project,
          cwd,
          session_limit: flagInt(p, "sessions"),
          knowledge_limit: flagInt(p, "limit"),
        }),
        json
      );
      return;
    }

    case "search": {
      const query = p.positional.join(" ");
      if (!query) throw new Error("Usage: claudit search \"<query>\"");
      emit(
        await search({
          query,
          project,
          cwd,
          type: flagStr(p, "type"),
          limit: flagInt(p, "limit"),
        }),
        json
      );
      return;
    }

    case "add": {
      const type = p.positional[0] as KnowledgeType | undefined;
      if (!type || !["solution", "pattern", "gotcha", "decision", "reference", "topic"].includes(type)) {
        throw new Error("Usage: claudit add <solution|pattern|gotcha|decision|reference|topic> --title \"...\" --content \"...\"");
      }
      const title = flagStr(p, "title");
      const content = flagStr(p, "content");
      if (!title || !content) {
        throw new Error("--title and --content are required");
      }
      emit(
        await addKnowledge({
          type,
          title,
          content,
          code: flagStr(p, "code"),
          file_paths: flagList(p, "files"),
          tags: flagList(p, "tags"),
          project,
          cwd,
        }),
        json
      );
      return;
    }

    case "list": {
      emit(
        list({
          project,
          cwd,
          type: flagStr(p, "type"),
          limit: flagInt(p, "limit"),
        }),
        json
      );
      return;
    }

    case "delete": {
      const id = parseInt(p.positional[0] ?? "", 10);
      if (isNaN(id)) throw new Error("Usage: claudit delete <id>");
      emit(deleteKnowledge({ id }), json);
      return;
    }

    case "annotate": {
      const [path, ...roleParts] = p.positional;
      const role = roleParts.join(" ");
      if (!path || !role) throw new Error("Usage: claudit annotate <path> \"<role>\"");
      emit(annotate({ path, role, project, cwd }), json);
      return;
    }

    case "log": {
      const summary = p.positional.join(" ");
      if (!summary) throw new Error("Usage: claudit log \"<summary>\" [--outcome ...] [--task ...]");
      const outcome = flagStr(p, "outcome") as Outcome | undefined;
      if (outcome && !["solved", "partial", "blocked", "exploratory"].includes(outcome)) {
        throw new Error("--outcome must be one of: solved, partial, blocked, exploratory");
      }
      emit(
        logSession({
          summary,
          task: flagStr(p, "task"),
          outcome,
          knowledge_ids: flagIntList(p, "ids"),
          project,
          cwd,
        }),
        json
      );
      return;
    }

    case "sessions": {
      emit(
        sessions({
          project,
          cwd,
          limit: flagInt(p, "limit"),
        }),
        json
      );
      return;
    }

    case "map": {
      emit(
        map({
          dir: p.positional[0],
          max_depth: flagInt(p, "depth"),
        }),
        json
      );
      return;
    }

    case "link": {
      const from = parseInt(p.positional[0] ?? "", 10);
      const to = parseInt(p.positional[1] ?? "", 10);
      if (isNaN(from) || isNaN(to)) {
        throw new Error("Usage: claudit link <from-id> <to-id> [--kind related|supersedes|contradicts|parent]");
      }
      const kindStr = flagStr(p, "kind");
      let kind: LinkKind | undefined;
      if (kindStr) {
        if (!isLinkKind(kindStr)) {
          throw new Error("--kind must be one of: related, supersedes, contradicts, parent");
        }
        kind = kindStr;
      }
      emit(link({ from, to, kind }), json);
      return;
    }

    case "unlink": {
      const from = parseInt(p.positional[0] ?? "", 10);
      const to = parseInt(p.positional[1] ?? "", 10);
      if (isNaN(from) || isNaN(to)) {
        throw new Error("Usage: claudit unlink <from-id> <to-id> [--kind ...]");
      }
      const kindStr = flagStr(p, "kind");
      let kind: LinkKind | undefined;
      if (kindStr) {
        if (!isLinkKind(kindStr)) {
          throw new Error("--kind must be one of: related, supersedes, contradicts, parent");
        }
        kind = kindStr;
      }
      emit(unlink({ from, to, kind }), json);
      return;
    }

    case "topic": {
      const id = parseInt(p.positional[0] ?? "", 10);
      if (isNaN(id)) throw new Error("Usage: claudit topic <id>");
      emit(topic({ id }), json);
      return;
    }

    case "lint": {
      emit(lint({ project, cwd }), json);
      return;
    }

    case "info": {
      emit(info(), json);
      return;
    }

    case "profile": {
      const sub = p.positional[0];
      switch (sub) {
        case "list":
          emit(profileList({ project, cwd }), json);
          return;
        case "set": {
          const name = p.positional[1];
          if (!name) throw new Error("Usage: claudit profile set <name> [-d \"description\"]");
          const description = flagStr(p, "d", "description");
          emit(await profileSet({ name, description, project, cwd }), json);
          return;
        }
        case "show":
          emit(profileShow({ cwd }), json);
          return;
        case "current":
          emit(profileCurrent(), json);
          return;
        case "clear":
          emit(profileClear(), json);
          return;
        case "delete": {
          const name = p.positional[1];
          if (!name) throw new Error("Usage: claudit profile delete <name>");
          emit(profileDelete({ name, project, cwd }), json);
          return;
        }
        case "drift": {
          const task = p.positional.slice(1).join(" ");
          if (!task) throw new Error("Usage: claudit profile drift \"<task>\"");
          emit(await profileDrift({ task, threshold: flagInt(p, "threshold") }), json);
          return;
        }
        default:
          throw new Error("profile subcommands: list | set | show | current | clear | delete | drift");
      }
    }

    default:
      printUsage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
