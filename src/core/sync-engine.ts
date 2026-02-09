import { Task } from '../types/claude.js';
import { SyncResult, SyncStateData } from '../types/sync.js';
import { readTeamTasks, readAllTasks } from './claude-reader.js';
import { loadSyncState, saveSyncState, findMapping, upsertMapping, removeMapping } from './sync-state.js';
import { mapTitle, mapBody, mapStatus, mapCustomFields, computeTaskHash } from './field-mapper.js';
import {
  createIssue,
  updateIssue,
  closeIssue,
  addProjectV2ItemById,
  updateTextField,
  updateSingleSelectField,
  archiveItem,
  createLabel,
  updateFieldOptions,
  getProjectFields,
} from './github-project.js';
import { runGraphQL } from '../utils/gh-auth.js';
import { logger } from '../utils/logger.js';
import { withLock } from '../utils/lock.js';
import { getLockFilePath } from '../utils/paths.js';

const LABEL_COLOR = '6f42c1'; // purple
const OWNER_COLORS = ['BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE', 'GRAY'];

/**
 * Ensure a team label exists (ccteams:{teamName}), creating it if needed.
 * Returns the label ID.
 */
async function ensureTeamLabel(state: SyncStateData, teamName: string): Promise<string> {
  const labelName = `ccteams:${teamName}`;

  if (state.labels[labelName]) {
    return state.labels[labelName];
  }

  try {
    const labelId = await createLabel(state.repository.id, labelName, LABEL_COLOR);
    state.labels[labelName] = labelId;
    return labelId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already exists')) {
      // Label exists but we don't have the ID — look it up
      const { getRepoLabels } = await import('./github-project.js');
      const labels = await getRepoLabels(state.repository.owner, state.repository.name, labelName);
      const found = labels.find(l => l.name === labelName);
      if (found) {
        state.labels[labelName] = found.id;
        return found.id;
      }
    }
    throw err;
  }
}

/**
 * Refresh cached owner option IDs from the project's "Agent (Owner)" field.
 */
async function refreshOwnerOptions(state: SyncStateData): Promise<void> {
  if (!state.ownerOptions) state.ownerOptions = {};

  const data = await runGraphQL(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id name options { id name }
              }
            }
          }
        }
      }
    }
  `, { projectId: state.project.id });

  for (const node of data.node.fields.nodes) {
    if (node.name === 'Agent (Owner)' && node.options) {
      state.ownerOptions = {};
      for (const opt of node.options) {
        state.ownerOptions[opt.name] = opt.id;
      }
      break;
    }
  }
}

/**
 * Pre-register all owner names as single-select options before syncing.
 * This avoids per-task option creation and timing issues.
 */
/**
 * Returns true if options were changed (new owners added).
 */
async function ensureOwnerOptions(state: SyncStateData, allTasks: Map<string, { task: Task; teamName: string }>): Promise<boolean> {
  const ownerFieldId = state.fields['Agent (Owner)'];
  if (!ownerFieldId) return false;
  if (!state.ownerOptions) state.ownerOptions = {};

  // Collect all unique owner names
  const ownerNames = new Set<string>();
  for (const { task } of allTasks.values()) {
    if (task.owner) ownerNames.add(task.owner);
  }

  // Find new owners not yet in options
  const newOwners = [...ownerNames].filter(name => !state.ownerOptions[name]);
  if (newOwners.length === 0) return false;

  // Build full options list: existing + new
  const allOptions = Object.keys(state.ownerOptions).map((name, i) => ({
    name,
    color: OWNER_COLORS[i % OWNER_COLORS.length],
    description: '',
  }));
  for (const name of newOwners) {
    allOptions.push({
      name,
      color: OWNER_COLORS[allOptions.length % OWNER_COLORS.length],
      description: '',
    });
  }

  logger.info(`Adding owner options: ${newOwners.join(', ')}`);
  await updateFieldOptions(ownerFieldId, allOptions);
  await refreshOwnerOptions(state);
  return true;
}

/**
 * Set all custom fields and status on a newly created project item.
 * effectiveOwner allows fallback to lastOwner when task.owner is empty.
 */
async function setAllFields(
  state: SyncStateData,
  itemId: string,
  task: Task,
  teamName: string,
  effectiveOwner?: string,
): Promise<void> {
  const projectId = state.project.id;

  // Set custom text fields (except Agent (Owner) which is SINGLE_SELECT)
  const customFields = mapCustomFields(task, teamName);
  for (const [fieldName, value] of Object.entries(customFields)) {
    if (fieldName === 'Agent (Owner)') continue;
    const fieldId = state.fields[fieldName];
    if (fieldId && value) {
      await updateTextField(projectId, itemId, fieldId, value);
    }
  }

  // Set Agent (Owner) as single-select
  // Use task.owner if present, otherwise fall back to effectiveOwner (lastOwner)
  const ownerName = task.owner || effectiveOwner;
  if (ownerName) {
    const ownerFieldId = state.fields['Agent (Owner)'];
    const ownerOptionId = state.ownerOptions?.[ownerName];
    if (ownerFieldId && ownerOptionId) {
      await updateSingleSelectField(projectId, itemId, ownerFieldId, ownerOptionId);
    }
  }

  // Set status
  const statusLabel = mapStatus(task.status);
  const statusFieldId = state.fields['Status'];
  const statusOptionId = state.statusOptions[statusLabel];
  if (statusFieldId && statusOptionId) {
    await updateSingleSelectField(projectId, itemId, statusFieldId, statusOptionId);
  }
}

/**
 * Set only the Agent (Owner) field on a project item.
 */
async function setOwnerField(
  state: SyncStateData,
  itemId: string,
  ownerName: string,
): Promise<void> {
  const ownerFieldId = state.fields['Agent (Owner)'];
  const ownerOptionId = state.ownerOptions?.[ownerName];
  if (ownerFieldId && ownerOptionId) {
    await updateSingleSelectField(state.project.id, itemId, ownerFieldId, ownerOptionId);
  }
}

/**
 * Sort tasks so that dependencies (blockedBy targets) are created before dependents.
 * This ensures parentIssueId is available when creating child issues.
 */
function sortByDependency(entries: Array<{ task: Task; teamName: string }>): Array<{ task: Task; teamName: string }> {
  const taskIds = new Set(entries.map(e => e.task.id));
  const sorted: Array<{ task: Task; teamName: string }> = [];
  const visited = new Set<string>();

  function visit(entry: { task: Task; teamName: string }) {
    const key = `${entry.teamName}:${entry.task.id}`;
    if (visited.has(key)) return;
    visited.add(key);

    // Visit dependencies first (only those in the current set)
    if (entry.task.blockedBy) {
      for (const depId of entry.task.blockedBy) {
        if (taskIds.has(depId)) {
          const dep = entries.find(e => e.task.id === depId);
          if (dep) visit(dep);
        }
      }
    }

    sorted.push(entry);
  }

  for (const entry of entries) {
    visit(entry);
  }

  return sorted;
}

/**
 * Core sync algorithm: reads tasks from disk, compares to sync state,
 * and creates/updates/archives real GitHub Issues in the linked repository.
 */
export async function syncTasks(options: {
  teamName?: string;
  dryRun?: boolean;
  quiet?: boolean;
}): Promise<SyncResult> {
  return withLock(getLockFilePath(), async () => {
  // loadSyncState() must be called inside the lock to read the latest state
  let state = await loadSyncState();
  if (!state) {
    // Auto-init under lock to prevent duplicate project creation
    const { autoInit } = await import('../commands/auto.js');
    await autoInit();
    state = await loadSyncState();
    if (!state) {
      throw new Error('Auto-init failed. Run `ccteams init --repo <owner/repo>` manually.');
    }
  }

  if (!state.repository?.id) {
    throw new Error('Repository not configured. Run `ccteams init --repo <owner/repo>` to set up.');
  }

  const result: SyncResult = {
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    errors: [],
  };

  // Collect tasks by team
  let tasksByTeam: Map<string, Task[]>;
  if (options.teamName) {
    const tasks = await readTeamTasks(options.teamName);
    tasksByTeam = new Map();
    if (tasks.length > 0) {
      tasksByTeam.set(options.teamName, tasks);
    }
  } else {
    tasksByTeam = await readAllTasks();
  }

  // Build a map of taskKey -> { task, teamName }
  const currentTasks = new Map<string, { task: Task; teamName: string }>();
  for (const [teamName, tasks] of tasksByTeam) {
    for (const task of tasks) {
      const key = `${teamName}:${task.id}`;
      currentTasks.set(key, { task, teamName });
    }
  }

  // Pre-register all owner names as single-select options
  // Also include lastOwner from sync state items so options aren't lost
  if (!options.dryRun) {
    for (const item of state.items) {
      if (item.lastOwner) {
        // Ensure lastOwner is also registered as an option
        const key = `${item.teamName}:${item.taskId}`;
        const entry = currentTasks.get(key);
        if (entry && !entry.task.owner) {
          // Task lost its owner; use lastOwner so the option stays registered
          currentTasks.set(key, {
            ...entry,
            task: { ...entry.task, owner: item.lastOwner },
          });
        }
      }
    }
    const ownersChanged = await ensureOwnerOptions(state, currentTasks);

    // If options changed (IDs may have been reassigned), re-apply owner on all existing items
    if (ownersChanged) {
      for (const item of state.items) {
        const ownerName = item.lastOwner;
        if (ownerName && item.githubItemId) {
          try {
            await setOwnerField(state, item.githubItemId, ownerName);
          } catch {
            // Best effort — don't fail the whole sync
          }
        }
      }
    }
  }

  // Determine which sync state items are in scope
  const scopedItems = options.teamName
    ? state.items.filter(item => item.teamName === options.teamName)
    : [...state.items];

  // Build set of keys from sync state items in scope
  const syncedKeys = new Set(scopedItems.map(item => `${item.teamName}:${item.taskId}`));

  // Collect new tasks (in currentTasks but not in sync state)
  const newEntries: Array<{ task: Task; teamName: string }> = [];
  for (const [key, entry] of currentTasks) {
    if (!syncedKeys.has(key)) {
      newEntries.push(entry);
    }
  }

  // Sort new tasks by dependency order so parents are created before children
  const sortedNewEntries = sortByDependency(newEntries);

  // Create new issues
  for (const { task, teamName } of sortedNewEntries) {
    const title = mapTitle(task);
    const body = mapBody(task, teamName);

    if (options.dryRun) {
      if (!options.quiet) logger.info(`[dry-run] Would create: ${title}`);
      result.created++;
      continue;
    }

    try {
      // Ensure team label exists
      let labelId: string | undefined;
      try {
        labelId = await ensureTeamLabel(state, teamName);
      } catch {
        logger.warn(`Could not create/find label for team "${teamName}", skipping label`);
      }

      // Resolve parentIssueId from blockedBy
      let parentIssueId: string | undefined;
      if (task.blockedBy && task.blockedBy.length > 0) {
        const parentTaskId = task.blockedBy[0];
        // Look up the parent's issue ID from sync state (it should be synced by now due to sorting)
        const parentMapping = findMapping(state, parentTaskId, teamName);
        if (parentMapping?.issueNodeId) {
          parentIssueId = parentMapping.issueNodeId;
        } else {
          // Try finding in other teams
          const crossTeamMapping = state.items.find(item => item.taskId === parentTaskId && item.issueNodeId);
          if (crossTeamMapping?.issueNodeId) {
            parentIssueId = crossTeamMapping.issueNodeId;
          }
        }
      }

      // Create real issue in repository
      const issue = await createIssue({
        repositoryId: state.repository.id,
        title,
        body,
        labelIds: labelId ? [labelId] : undefined,
        projectIds: [state.project.id],
        parentIssueId,
      });

      // The issue is already added to the project via projectV2Ids in createIssue.
      // We need the project item ID for setting custom fields.
      // Use addProjectV2ItemById which returns item ID (it's idempotent if already added).
      let itemId: string;
      try {
        itemId = await addProjectV2ItemById(state.project.id, issue.id);
      } catch {
        // If already added via createIssue's projectV2Ids, the addProjectV2ItemById
        // should still return the item ID. If it fails, we can't set custom fields.
        logger.warn(`Could not get project item ID for issue #${issue.number}, skipping custom fields`);
        itemId = '';
      }

      // Set custom fields on the project item
      const effectiveOwner = task.owner || '';
      if (itemId) {
        await setAllFields(state, itemId, task, teamName, effectiveOwner);
      }

      const hash = computeTaskHash(task, teamName);
      upsertMapping(state, {
        taskId: task.id,
        teamName,
        githubItemId: itemId,
        contentId: issue.id,
        issueNodeId: issue.id,
        issueNumber: issue.number,
        lastHash: hash,
        lastSyncedAt: new Date().toISOString(),
        lastOwner: effectiveOwner || undefined,
      });

      result.created++;
      if (!options.quiet) logger.success(`Created: ${title} (#${issue.number})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ taskId: task.id, error: message });
      logger.error(`Failed to create ${title}: ${message}`);
    }
  }

  // Changed and unchanged: in both currentTasks and sync state
  for (const item of scopedItems) {
    const key = `${item.teamName}:${item.taskId}`;
    const entry = currentTasks.get(key);
    if (!entry) continue; // will be handled as deleted

    const { task, teamName } = entry;
    const hash = computeTaskHash(task, teamName);

    if (hash === item.lastHash) {
      result.skipped++;
      continue;
    }

    // Hash changed - update
    const title = mapTitle(task);
    const body = mapBody(task, teamName);

    if (options.dryRun) {
      if (!options.quiet) logger.info(`[dry-run] Would update: ${title}`);
      result.updated++;
      continue;
    }

    try {
      // Update the real issue
      if (item.issueNodeId) {
        await updateIssue(item.issueNodeId, title, body);
      }

      // Update project item custom fields
      const effectiveOwner = task.owner || item.lastOwner || '';
      if (item.githubItemId) {
        await setAllFields(state, item.githubItemId, task, teamName, effectiveOwner);
      }

      upsertMapping(state, {
        ...item,
        lastHash: hash,
        lastSyncedAt: new Date().toISOString(),
        lastOwner: effectiveOwner || undefined,
      });

      result.updated++;
      if (!options.quiet) logger.success(`Updated: ${title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ taskId: task.id, error: message });
      logger.error(`Failed to update ${title}: ${message}`);
    }
  }

  // Deleted: in sync state but not in currentTasks
  for (const item of scopedItems) {
    const key = `${item.teamName}:${item.taskId}`;
    if (currentTasks.has(key)) continue;

    if (options.dryRun) {
      if (!options.quiet) logger.info(`[dry-run] Would archive: ${item.teamName}:${item.taskId}`);
      result.archived++;
      continue;
    }

    try {
      // Close the real issue
      if (item.issueNodeId) {
        await closeIssue(item.issueNodeId);
      }

      // Archive the project item
      if (item.githubItemId) {
        await archiveItem(state.project.id, item.githubItemId);
      }

      removeMapping(state, item.taskId, item.teamName);

      result.archived++;
      if (!options.quiet) logger.success(`Archived: ${item.teamName}:${item.taskId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ taskId: item.taskId, error: message });
      logger.error(`Failed to archive ${item.teamName}:${item.taskId}: ${message}`);
    }
  }

  // Save updated state
  if (!options.dryRun) {
    await saveSyncState(state);
  }

  return result;
  }); // end withLock
}
