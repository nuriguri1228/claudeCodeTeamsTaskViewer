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
 * Filters out team member assignment tasks (subject matches a member name).
 */
export async function readTeamTasks(teamName: string): Promise<Task[]> {
  const tasksDir = getTeamTasksDir(teamName);
  if (!existsSync(tasksDir)) {
    logger.warn(`Tasks directory not found: ${tasksDir}`);
    return [];
  }

  // Get team member names to filter out member assignment tasks
  const memberNames = new Set<string>();
  const config = await readTeamConfig(teamName);
  if (config) {
    for (const member of config.members) {
      memberNames.add(member.name);
    }
  }

  const files = await readdir(tasksDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  const tasks: Task[] = [];

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(tasksDir, file), 'utf-8');
      const task = JSON.parse(content) as Task;
      if (!task.id || !task.subject) {
        logger.warn(`Skipping invalid task file: ${file}`);
        continue;
      }
      // Skip tasks whose subject is a team member name (these are member assignments, not real tasks)
      if (memberNames.has(task.subject)) {
        logger.debug(`Skipping member assignment task: ${task.subject}`);
        continue;
      }
      tasks.push(task);
    } catch (err) {
      logger.warn(`Failed to parse task file: ${file}`);
    }
  }

  return tasks;
}

/**
 * List active team names — only teams that have both:
 *   - a task directory in ~/.claude/tasks/{teamName}/
 *   - a config file in ~/.claude/teams/{teamName}/config.json
 * This prevents syncing leftover/orphaned task directories from old sessions.
 */
export async function listTeamNames(): Promise<string[]> {
  const tasksDir = getTasksDir();
  if (!existsSync(tasksDir)) {
    return [];
  }

  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && existsSync(getTeamConfigPath(e.name)))
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
