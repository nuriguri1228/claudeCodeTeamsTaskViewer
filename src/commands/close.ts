import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadSyncState } from '../core/sync-state.js';
import { closeIssue, closeProject } from '../core/github-project.js';
import { getSyncFilePath, getLockFilePath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export async function closeCommand(options: { force?: boolean }): Promise<void> {
  const state = await loadSyncState();
  if (!state) {
    logger.error('No sync state found (.ccteams-sync.json). Nothing to close.');
    process.exit(1);
  }

  logger.info(`Project: ${state.project.title} (${state.project.url})`);
  logger.info(`Tracked issues: ${state.items.length}`);

  if (!options.force) {
    const ok = await confirm('This will close all tracked issues and the GitHub Project. Continue?');
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

  // Close the GitHub Project (preserved on GitHub, just marked as closed)
  try {
    await closeProject(state.project.id);
    logger.info(`Closed project: ${state.project.title}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to close project: ${message}`);
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

  logger.success('Project closed. Issues and project are preserved on GitHub.');
}
