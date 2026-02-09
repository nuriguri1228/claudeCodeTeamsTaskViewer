import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { loadSyncState } from '../core/sync-state.js';
import { closeIssue } from '../core/github-project.js';
import { deleteProject } from '../core/github-project.js';
import { getSyncFilePath, getLockFilePath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'node:fs';

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function resetCommand(options: { force?: boolean }): Promise<void> {
  const state = await loadSyncState();
  if (!state) {
    logger.error('No sync state found (.ccteams-sync.json). Nothing to reset.');
    process.exit(1);
  }

  logger.info(`Project: ${state.project.title} (${state.project.url})`);
  logger.info(`Tracked issues: ${state.items.length}`);

  if (!options.force) {
    const ok = await confirm('This will close all tracked issues, delete the GitHub Project, and remove the sync state. Continue?');
    if (!ok) {
      logger.info('Aborted.');
      return;
    }
  }

  // Close all tracked issues
  let closedCount = 0;
  for (const item of state.items) {
    if (item.issueNodeId) {
      try {
        await closeIssue(item.issueNodeId);
        closedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to close issue #${item.issueNumber}: ${message}`);
      }
    }
  }
  if (closedCount > 0) {
    logger.info(`Closed ${closedCount} issue(s).`);
  }

  // Delete the GitHub Project
  try {
    await deleteProject(state.project.id);
    logger.info(`Deleted project: ${state.project.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to delete project: ${message}`);
  }

  // Remove sync state file
  const syncFilePath = getSyncFilePath();
  await unlink(syncFilePath);
  logger.info(`Removed ${syncFilePath}`);

  // Remove lock file if it exists
  const lockFilePath = getLockFilePath();
  if (existsSync(lockFilePath)) {
    await unlink(lockFilePath);
  }

  logger.success('Reset complete.');
}
