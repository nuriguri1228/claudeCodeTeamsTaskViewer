import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadSyncState } from '../core/sync-state.js';
import { syncTasks } from '../core/sync-engine.js';
import { checkGhAuth, checkProjectScope } from '../utils/gh-auth.js';
import { listTeamNames } from '../core/claude-reader.js';
import { performInit } from './init.js';
import { parseGitRemoteUrl } from '../utils/git.js';
import { logger } from '../utils/logger.js';
import { SyncResult } from '../types/sync.js';

const execFileAsync = promisify(execFile);

/**
 * Default command: iterate over active teams, auto-init each if needed, then sync.
 */
export async function autoCommand(): Promise<void> {
  const teamNames = await listTeamNames();
  if (teamNames.length === 0) {
    logger.warn('No active teams found in ~/.claude/tasks/. Nothing to sync.');
    return;
  }

  const aggregateResult: SyncResult = {
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    errors: [],
  };

  for (const teamName of teamNames) {
    logger.info(`\n--- Team: ${teamName} ---`);

    // Check if this team has sync state; if not, auto-init
    const existingState = await loadSyncState(teamName);
    if (!existingState) {
      await autoInitTeam(teamName);
    } else {
      logger.info(`Syncing tasks to project: ${existingState.project.title}`);
    }

    const result = await syncTasks({ teamName });
    aggregateResult.created += result.created;
    aggregateResult.updated += result.updated;
    aggregateResult.archived += result.archived;
    aggregateResult.skipped += result.skipped;
    aggregateResult.errors.push(...result.errors);
  }

  printSyncResult(aggregateResult);
}

/**
 * Auto-detect repo and create a project for a single team.
 */
export async function autoInitTeam(teamName: string): Promise<void> {
  logger.info(`No sync state found for team "${teamName}". Auto-initializing...`);

  // Check gh auth
  const isAuthed = await checkGhAuth();
  if (!isAuthed) {
    process.exit(1);
  }
  const hasScope = await checkProjectScope();
  if (!hasScope) {
    process.exit(1);
  }

  // Detect repo from git remote
  let remoteUrl: string;
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin']);
    remoteUrl = stdout.trim();
  } catch {
    logger.error('Could not detect git remote. Run this command inside a git repository with an "origin" remote.');
    process.exit(1);
  }

  const { owner: repoOwner, name: repoName } = parseGitRemoteUrl(remoteUrl);
  logger.info(`Detected repository: ${repoOwner}/${repoName}`);

  const title = `ccteams: ${teamName}`;

  // Perform init for this specific team
  await performInit({ repoOwner, repoName, title, teamName });
}

function printSyncResult(result: { created: number; updated: number; archived: number; skipped: number; errors: Array<{ taskId: string; error: string }> }): void {
  logger.info('\n--- Sync Results ---');
  logger.info(`Created:  ${result.created}`);
  logger.info(`Updated:  ${result.updated}`);
  logger.info(`Archived: ${result.archived}`);
  logger.info(`Skipped:  ${result.skipped}`);

  if (result.errors.length > 0) {
    logger.warn(`Errors:   ${result.errors.length}`);
    for (const err of result.errors) {
      logger.error(`  ${err.taskId}: ${err.error}`);
    }
  }
}
