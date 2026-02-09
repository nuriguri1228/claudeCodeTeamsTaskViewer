import chokidar from 'chokidar';
import { loadSyncState } from '../core/sync-state.js';
import { syncTasks } from '../core/sync-engine.js';
import { getTasksDir, getTeamTasksDir } from '../utils/paths.js';
import { DEFAULT_DEBOUNCE_MS } from '../constants.js';
import { logger } from '../utils/logger.js';

export async function watchCommand(options: { team?: string; debounce?: number }): Promise<void> {
  const state = await loadSyncState();
  if (!state) {
    logger.error('Sync state not found. Run `ccteams init` first.');
    process.exit(1);
  }

  const debounceMs = options.debounce ?? DEFAULT_DEBOUNCE_MS;
  const watchPath = options.team ? getTeamTasksDir(options.team) : getTasksDir();

  logger.info(`Watching for task changes: ${watchPath}`);
  logger.info(`Debounce: ${debounceMs}ms`);
  logger.dim('Press Ctrl+C to stop.');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isSyncing = false;

  const runSync = async () => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      logger.info('Changes detected, syncing...');
      const result = await syncTasks({
        teamName: options.team,
        quiet: false,
      });
      logger.info(
        `Sync complete: ${result.created} created, ${result.updated} updated, ${result.archived} archived, ${result.skipped} skipped`,
      );
      if (result.errors.length > 0) {
        logger.warn(`${result.errors.length} error(s) during sync`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Sync failed: ${message}`);
    } finally {
      isSyncing = false;
    }
  };

  const debouncedSync = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(runSync, debounceMs);
  };

  const watcher = chokidar.watch(watchPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
  });

  watcher.on('add', debouncedSync);
  watcher.on('change', debouncedSync);
  watcher.on('unlink', debouncedSync);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down watcher...');
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    await watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
