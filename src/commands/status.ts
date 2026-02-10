import { loadSyncState } from '../core/sync-state.js';
import { listSyncedTeamNames } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

export async function statusCommand(): Promise<void> {
  const teamNames = await listSyncedTeamNames();
  if (teamNames.length === 0) {
    logger.error('No sync state found. Run `ccteams init` or `ccteams` first.');
    process.exit(1);
  }

  for (const teamName of teamNames) {
    const state = await loadSyncState(teamName);
    if (!state) continue;

    logger.info(`--- Team: ${teamName} ---`);
    logger.info(`Project: ${state.project.title}`);
    logger.info(`URL:     ${state.project.url}`);
    logger.info(`Owner:   ${state.project.owner}`);
    logger.info(`Last sync: ${state.lastSyncAt}`);
    logger.info(`Synced items: ${state.items.length}`);

    if (state.items.length > 0) {
      // Count items per team (in per-team state, all items belong to the same team)
      const teamCounts = new Map<string, number>();
      for (const item of state.items) {
        const count = teamCounts.get(item.teamName) ?? 0;
        teamCounts.set(item.teamName, count + 1);
      }
      for (const [team, count] of teamCounts) {
        logger.info(`  ${team}: ${count}`);
      }
    }

    logger.info('');
  }
}
