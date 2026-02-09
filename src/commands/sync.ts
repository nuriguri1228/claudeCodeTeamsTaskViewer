import { loadSyncState } from '../core/sync-state.js';
import { syncTasks } from '../core/sync-engine.js';
import { autoInit } from './auto.js';
import { logger } from '../utils/logger.js';

export async function syncCommand(options: { team?: string; dryRun?: boolean; quiet?: boolean }): Promise<void> {
  let state = await loadSyncState();
  if (!state) {
    await autoInit();
    state = await loadSyncState();
    if (!state) {
      logger.error('Auto-init failed. Run `ccteams init --repo <owner/repo>` manually.');
      process.exit(1);
    }
  }

  if (!options.quiet) {
    logger.info(`Syncing tasks to project: ${state.project.title}`);
    if (options.team) {
      logger.info(`Team filter: ${options.team}`);
    }
    if (options.dryRun) {
      logger.info('Dry run mode - no changes will be made.');
    }
  }

  const result = await syncTasks({
    teamName: options.team,
    dryRun: options.dryRun,
    quiet: options.quiet,
  });

  if (!options.quiet) {
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
}
