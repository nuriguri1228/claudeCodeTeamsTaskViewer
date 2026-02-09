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

  // Role assignment prompt patterns — tasks with these in description are agent assignments, not real work
  const roleAssignmentPatterns = [
    /^You are the\b/i,
    /^당신은\b/,
    /에이전트입니다/,
    /^You are a\b/i,
    /^Act as\b/i,
  ];

  const files = await readdir(tasksDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  // First pass: collect all tasks and all owner names (parallel file I/O)
  const allParsed: Task[] = [];
  const ownerNames = new Set<string>();
  const parseResults = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const content = await readFile(join(tasksDir, file), 'utf-8');
        const task = JSON.parse(content) as Task;
        if (!task.id || !task.subject) {
          logger.warn(`Skipping invalid task file: ${file}`);
          return null;
        }
        return task;
      } catch (err) {
        logger.warn(`Failed to parse task file: ${file}`);
        return null;
      }
    }),
  );
  for (const task of parseResults) {
    if (task) {
      allParsed.push(task);
      if (task.owner) ownerNames.add(task.owner);
    }
  }

  // Second pass: filter out member assignment tasks
  const tasks: Task[] = [];
  for (const task of allParsed) {
    // Skip tasks whose subject is a team member name from config
    if (memberNames.has(task.subject)) {
      logger.debug(`Skipping member assignment task (config match): ${task.subject}`);
      continue;
    }
    // Skip tasks whose subject matches another task's owner (member assignment pattern)
    if (ownerNames.has(task.subject)) {
      logger.debug(`Skipping member assignment task (owner match): ${task.subject}`);
      continue;
    }
    // Skip tasks whose description matches role assignment prompt patterns
    if (task.description && roleAssignmentPatterns.some(p => p.test(task.description))) {
      logger.debug(`Skipping role assignment task: ${task.subject}`);
      continue;
    }
    tasks.push(task);
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

  const entries = await Promise.all(
    teamNames.map(async (teamName) => {
      const tasks = await readTeamTasks(teamName);
      return { teamName, tasks };
    }),
  );
  for (const { teamName, tasks } of entries) {
    if (tasks.length > 0) {
      result.set(teamName, tasks);
    }
  }

  return result;
}
