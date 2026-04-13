/**
 * Shared types for command functions.
 * Each command returns text (for human output) + json (for --json mode).
 */

export interface CommandResult {
  text: string;
  json: unknown;
}
