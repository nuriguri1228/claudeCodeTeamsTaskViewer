import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadSyncState } from '../core/sync-state.js';
import { syncTasks } from '../core/sync-engine.js';
import { checkGhAuth, checkProjectScope } from '../utils/gh-auth.js';
import { listTeamNames } from '../core/claude-reader.js';
import { performInit } from './init.js';
import { parseGitRemoteUrl } from '../utils/git.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Default command: auto-init (if needed) + sync.
 */
export async function autoCommand(): Promise<void> {
  // If sync state exists, just sync
  const existingState = await loadSyncState();
  if (existingState) {
    logger.info(`Syncing tasks to project: ${existingState.project.title}`);
    const result = await syncTasks({});
    printSyncResult(result);
    return;
  }

  // No sync state — auto-init
  logger.info('No sync state found. Auto-initializing...');

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

  // Generate project title based on teams
  const teamNames = await listTeamNames();
  let title: string;
  if (teamNames.length === 0) {
    title = `ccteams: ${repoName}`;
  } else if (teamNames.length === 1) {
    title = `ccteams: ${teamNames[0]}`;
  } else {
    title = `ccteams: ${teamNames.join(', ')}`;
  }

  // Perform init
  await performInit({ repoOwner, repoName, title });

  // Immediately sync
  logger.info('Running initial sync...');
  const result = await syncTasks({});
  printSyncResult(result);
}

function printSyncResult(result: { created: number; updated: number; archived: number; skipped: number; errors: Array<{ taskId: string; error: string }> }): void {
  logger.info('--- Sync Results ---');
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
