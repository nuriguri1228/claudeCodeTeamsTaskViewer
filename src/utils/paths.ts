import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function getSyncFilePath(): string {
  return join(process.cwd(), '.ccteams-sync.json');
}

export function getLockFilePath(): string {
  return join(process.cwd(), '.ccteams-sync.lock');
}
