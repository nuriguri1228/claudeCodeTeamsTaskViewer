import chokidar from 'chokidar';
import { syncTasks } from '../core/sync-engine.js';
import { listTeamNames } from '../core/claude-reader.js';
import { getTasksDir, getTeamTasksDir } from '../utils/paths.js';
import { DEFAULT_DEBOUNCE_MS } from '../constants.js';
import { logger } from '../utils/logger.js';

export async function watchCommand(options: { team?: string; debounce?: number }): Promise<void> {
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

      // Determine which teams to sync
      let teamNames: string[];
      if (options.team) {
        teamNames = [options.team];
      } else {
        teamNames = await listTeamNames();
      }

      let totalCreated = 0, totalUpdated = 0, totalArchived = 0, totalSkipped = 0;
      const allErrors: Array<{ taskId: string; error: string }> = [];

      for (const teamName of teamNames) {
        const result = await syncTasks({
          teamName,
          quiet: false,
        });
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalArchived += result.archived;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors);
      }

      logger.info(
        `Sync complete: ${totalCreated} created, ${totalUpdated} updated, ${totalArchived} archived, ${totalSkipped} skipped`,
      );
      if (allErrors.length > 0) {
        logger.warn(`${allErrors.length} error(s) during sync`);
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
