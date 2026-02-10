import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export function getClaudeDir(): string {
  return join(homedir(), '.claude');
}

export function getTeamsDir(): string {
  return join(getClaudeDir(), 'teams');
}

export function getTasksDir(): string {
  return join(getClaudeDir(), 'tasks');
}

export function getTeamConfigPath(teamName: string): string {
  return join(getTeamsDir(), teamName, 'config.json');
}

export function getTeamTasksDir(teamName: string): string {
  return join(getTasksDir(), teamName);
}

export function getSyncFilePath(teamName: string): string {
  return join(process.cwd(), `.ccteams-sync.${teamName}.json`);
}

export function getLockFilePath(teamName: string): string {
  return join(process.cwd(), `.ccteams-sync.${teamName}.lock`);
}

/**
 * List team names that have a sync state file in the current directory.
 * Scans for `.ccteams-sync.*.json` files and extracts the team name.
 */
export async function listSyncedTeamNames(): Promise<string[]> {
  const cwd = process.cwd();
  if (!existsSync(cwd)) return [];

  const entries = await readdir(cwd);
  const prefix = '.ccteams-sync.';
  const suffix = '.json';
  const names: string[] = [];

  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
      const teamName = entry.slice(prefix.length, -suffix.length);
      // Filter out lock files or empty names
      if (teamName && !teamName.endsWith('.lock')) {
        names.push(teamName);
      }
    }
  }

  return names.sort();
}
