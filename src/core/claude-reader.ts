import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Task, TeamConfig } from '../types/claude.js';
import { getTeamConfigPath, getTeamTasksDir, getTasksDir } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

/**
 * Read team config from ~/.claude/teams/{teamName}/config.json
 */
export async function readTeamConfig(teamName: string): Promise<TeamConfig | null> {
  const configPath = getTeamConfigPath(teamName);
  if (!existsSync(configPath)) {
    logger.warn(`Team config not found: ${configPath}`);
    return null;
  }
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as TeamConfig;
  } catch (err) {
    logger.error(`Failed to parse team config: ${configPath}`);
    return null;
  }
}

/**
 * Read all tasks for a team from ~/.claude/tasks/{teamName}/
 */
export async function readTeamTasks(teamName: string): Promise<Task[]> {
  const tasksDir = getTeamTasksDir(teamName);
  if (!existsSync(tasksDir)) {
    logger.warn(`Tasks directory not found: ${tasksDir}`);
    return [];
  }

  const files = await readdir(tasksDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  const tasks: Task[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(tasksDir, file), 'utf-8');
      const task = JSON.parse(content) as Task;
      if (task.id && task.subject) {
        tasks.push(task);
      } else {
        logger.warn(`Skipping invalid task file: ${file}`);
      }
    } catch (err) {
      logger.warn(`Failed to parse task file: ${file}`);
    }
  }

  return tasks;
}

// UUID pattern: 8-4-4-4-12 hex characters
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * List all available team names by scanning ~/.claude/tasks/
 * Excludes UUID-named directories (session IDs, not real team names).
 */
export async function listTeamNames(): Promise<string[]> {
  const tasksDir = getTasksDir();
  if (!existsSync(tasksDir)) {
    return [];
  }

  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !UUID_RE.test(e.name))
    .map(e => e.name);
}

/**
 * Read all tasks across all teams. Returns a map of teamName -> Task[]
 */
export async function readAllTasks(): Promise<Map<string, Task[]>> {
  const teamNames = await listTeamNames();
  const result = new Map<string, Task[]>();

  for (const teamName of teamNames) {
    const tasks = await readTeamTasks(teamName);
    if (tasks.length > 0) {
      result.set(teamName, tasks);
    }
  }

  return result;
}
