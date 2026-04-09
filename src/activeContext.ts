/**
 * Active context state — which context profile is currently loaded.
 *
 * Single global file at ~/.local/share/claudit/active-context.json (override:
 * $CLAUDIT_ACTIVE_FILE). The `claudit run` wrapper owns the write/clear
 * lifecycle — it writes on session start and removes on session end. The status
 * line reads this file to display the active profile name.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const ACTIVE_FILE =
  process.env.CLAUDIT_ACTIVE_FILE ??
  join(homedir(), ".local", "share", "claudit", "active-context.json");

export interface ActiveContext {
  context_id: number;
  name: string;
  project: string;
  description: string;
  set_at: string;
}

export function activeContextPath(): string {
  return ACTIVE_FILE;
}

export function readActiveContext(): ActiveContext | null {
  if (!existsSync(ACTIVE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(ACTIVE_FILE, "utf8")) as ActiveContext;
  } catch {
    return null;
  }
}

export function writeActiveContext(ctx: ActiveContext): void {
  const dir = dirname(ACTIVE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ACTIVE_FILE, JSON.stringify(ctx, null, 2));
}

export function clearActiveContext(): void {
  if (existsSync(ACTIVE_FILE)) rmSync(ACTIVE_FILE);
}
