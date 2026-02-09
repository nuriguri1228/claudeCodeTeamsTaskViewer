import { writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { logger } from './logger.js';

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const POLL_INTERVAL_MS = 1000; // 1 second
const MAX_WAIT_MS = 30 * 1000; // 30 seconds

interface LockData {
  pid: number;
  acquiredAt: string;
}

/**
 * Acquire an exclusive lock file using `wx` (exclusive create) flag.
 * If the lock already exists, check if it's stale (>2min). If stale, remove and retry.
 * Otherwise, poll every 1s for up to 30s.
 */
export async function acquireLock(lockPath: string): Promise<void> {
  const lockData: LockData = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  const deadline = Date.now() + MAX_WAIT_MS;

  while (true) {
    try {
      await writeFile(lockPath, JSON.stringify(lockData), { flag: 'wx' });
      return; // lock acquired
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      // Lock file exists — check if stale
      const isStale = await checkStale(lockPath);
      if (isStale) {
        try {
          await unlink(lockPath);
          logger.debug('Removed stale lock file, retrying...');
          continue; // retry immediately
        } catch {
          // Another process may have removed it already
        }
      }

      // Not stale — wait and retry
      if (Date.now() >= deadline) {
        throw new Error(
          `Could not acquire lock at ${lockPath} after ${MAX_WAIT_MS / 1000}s. ` +
          'Another sync process may be running. Remove the lock file manually if this is an error.',
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/**
 * Release the lock file.
 */
export async function releaseLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    // Already removed — fine
  }
}

/**
 * Execute `fn` while holding an exclusive lock.
 */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath);
  }
}

async function checkStale(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const data: LockData = JSON.parse(content);
    const age = Date.now() - new Date(data.acquiredAt).getTime();
    return age > STALE_THRESHOLD_MS;
  } catch {
    // If we can't read/parse, check file mtime as fallback
    try {
      const st = await stat(lockPath);
      const age = Date.now() - st.mtimeMs;
      return age > STALE_THRESHOLD_MS;
    } catch {
      return true; // Can't stat either — treat as stale
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
