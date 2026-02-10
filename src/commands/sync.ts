import { syncTasks } from '../core/sync-engine.js';
import { listTeamNames } from '../core/claude-reader.js';
import { logger } from '../utils/logger.js';
import { SyncResult } from '../types/sync.js';

export async function syncCommand(options: { team?: string; dryRun?: boolean; quiet?: boolean }): Promise<void> {
  if (!options.quiet) {
    if (options.team) {
      logger.info(`Team filter: ${options.team}`);
    }
    if (options.dryRun) {
      logger.info('Dry run mode - no changes will be made.');
    }
  }

  // Determine which teams to sync
  let teamNames: string[];
  if (options.team) {
    teamNames = [options.team];
  } else {
    teamNames = await listTeamNames();
    if (teamNames.length === 0) {
      logger.warn('No active teams found. Nothing to sync.');
      return;
    }
  }

  const aggregate: SyncResult = {
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    errors: [],
  };

  for (const teamName of teamNames) {
    const result = await syncTasks({
      teamName,
      dryRun: options.dryRun,
      quiet: options.quiet,
    });
    aggregate.created += result.created;
    aggregate.updated += result.updated;
    aggregate.archived += result.archived;
    aggregate.skipped += result.skipped;
    aggregate.errors.push(...result.errors);
  }

  if (!options.quiet) {
    logger.info('--- Sync Results ---');
    logger.info(`Created:  ${aggregate.created}`);
    logger.info(`Updated:  ${aggregate.updated}`);
    logger.info(`Archived: ${aggregate.archived}`);
    logger.info(`Skipped:  ${aggregate.skipped}`);

    if (aggregate.errors.length > 0) {
      logger.warn(`Errors:   ${aggregate.errors.length}`);
      for (const err of aggregate.errors) {
        logger.error(`  ${err.taskId}: ${err.error}`);
      }
    }
  }
}
