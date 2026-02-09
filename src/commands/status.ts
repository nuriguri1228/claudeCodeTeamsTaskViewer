import { loadSyncState } from '../core/sync-state.js';
import { logger } from '../utils/logger.js';

export async function statusCommand(): Promise<void> {
  const state = await loadSyncState();
  if (!state) {
    logger.error('Sync state not found. Run `ccteams init` first.');
    process.exit(1);
  }

  logger.info(`Project: ${state.project.title}`);
  logger.info(`URL:     ${state.project.url}`);
  logger.info(`Owner:   ${state.project.owner}`);
  logger.info(`Last sync: ${state.lastSyncAt}`);

  // Count items per team
  const teamCounts = new Map<string, number>();
  for (const item of state.items) {
    const count = teamCounts.get(item.teamName) ?? 0;
    teamCounts.set(item.teamName, count + 1);
  }

  logger.info('');
  logger.info(`Total synced items: ${state.items.length}`);

  if (teamCounts.size > 0) {
    logger.info('Items per team:');
    for (const [team, count] of teamCounts) {
      logger.info(`  ${team}: ${count}`);
    }
  } else {
    logger.dim('No items synced yet. Run `ccteams sync` to sync tasks.');
  }
}
