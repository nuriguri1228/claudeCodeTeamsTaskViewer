import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { SyncStateData, ItemMapping } from '../types/sync.js';
import { getSyncFilePath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';

/**
 * Load sync state from .ccteams-sync.json
 */
export async function loadSyncState(): Promise<SyncStateData | null> {
  const filePath = getSyncFilePath();
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as SyncStateData;
  } catch (err) {
    logger.error(`Failed to parse sync state: ${filePath}`);
    return null;
  }
}

/**
 * Save sync state to .ccteams-sync.json
 */
export async function saveSyncState(state: SyncStateData): Promise<void> {
  const filePath = getSyncFilePath();
  state.lastSyncAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  logger.debug(`Sync state saved to ${filePath}`);
}

/**
 * Find an item mapping by task ID and team name
 */
export function findMapping(state: SyncStateData, taskId: string, teamName: string): ItemMapping | undefined {
  return state.items.find(item => item.taskId === taskId && item.teamName === teamName);
}

/**
 * Add or update an item mapping
 */
export function upsertMapping(state: SyncStateData, mapping: ItemMapping): void {
  const index = state.items.findIndex(
    item => item.taskId === mapping.taskId && item.teamName === mapping.teamName
  );
  if (index >= 0) {
    state.items[index] = mapping;
  } else {
    state.items.push(mapping);
  }
}

/**
 * Remove an item mapping
 */
export function removeMapping(state: SyncStateData, taskId: string, teamName: string): void {
  state.items = state.items.filter(
    item => !(item.taskId === taskId && item.teamName === teamName)
  );
}

/**
 * Create initial sync state for a newly initialized project
 */
export function createInitialSyncState(
  project: SyncStateData['project'],
  fields: Record<string, string>,
  statusOptions: Record<string, string>,
  repository: SyncStateData['repository'],
): SyncStateData {
  return {
    project,
    repository,
    fields,
    statusOptions,
    ownerOptions: {},
    labels: {},
    items: [],
    lastSyncAt: new Date().toISOString(),
  };
}
