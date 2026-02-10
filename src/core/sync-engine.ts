import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { Task } from '../types/claude.js';
import { SyncResult, SyncStateData } from '../types/sync.js';
import { readTeamTasks, readAllTasks } from './claude-reader.js';
import { loadSyncState, saveSyncState, findMapping, upsertMapping } from './sync-state.js';
import { mapTitle, mapBody, mapStatus, mapCustomFields, computeTaskHash } from './field-mapper.js';
import {
  createIssue,
  updateIssue,
  addProjectV2ItemById,
  updateTextField,
  updateSingleSelectField,
  createLabel,
  updateFieldOptions,
  getProjectFields,
  getDefaultBranchOid,
  isBranchLinkedToIssue,
  linkExistingBranchToIssue,
  ensureLabelsOnIssue,
} from './github-project.js';
import { runGraphQL } from '../utils/gh-auth.js';
import { logger } from '../utils/logger.js';
import { withLock } from '../utils/lock.js';
import { getLockFilePath } from '../utils/paths.js';
import { pMap } from '../utils/concurrency.js';

const execAsync = promisify(execCb);

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
 * Refresh cached option IDs for ALL single-select fields (Status, Agent (Owner), etc.)
 * from the live project. This prevents stale-ID errors when GitHub reassigns option IDs.
 */
async function refreshSelectOptions(state: SyncStateData): Promise<void> {
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
    }
    if (node.name === 'Status' && node.options) {
      state.statusOptions = {};
      for (const opt of node.options) {
        state.statusOptions[opt.name] = opt.id;
      }
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

  // Collect all unique owner names from tasks
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
  await refreshSelectOptions(state);
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

  // Collect all field update promises to run in parallel
  const fieldUpdates: Promise<void>[] = [];

  // Custom text fields (except Agent (Owner) which is SINGLE_SELECT)
  const customFields = mapCustomFields(task, teamName);
  for (const [fieldName, value] of Object.entries(customFields)) {
    if (fieldName === 'Agent (Owner)') continue;
    const fieldId = state.fields[fieldName];
    if (fieldId && value) {
      fieldUpdates.push(updateTextField(projectId, itemId, fieldId, value));
    }
  }

  // Agent (Owner) as single-select
  // Use task.owner if present, otherwise fall back to effectiveOwner (lastOwner).
  // If still empty, use "(unassigned)" only when that option already exists in the project.
  const ownerName = task.owner || effectiveOwner;
  {
    const resolvedOwner = ownerName || (state.ownerOptions?.['(unassigned)'] ? '(unassigned)' : '');
    const ownerFieldId = state.fields['Agent (Owner)'];
    if (resolvedOwner && ownerFieldId) {
      const ownerOptionId = state.ownerOptions?.[resolvedOwner];
      if (ownerOptionId) {
        fieldUpdates.push(updateSingleSelectField(projectId, itemId, ownerFieldId, ownerOptionId));
      } else {
        logger.warn(`Owner option "${resolvedOwner}" not found in cache, skipping (will be set on next sync)`);
      }
    }
  }

  // Status
  const statusLabel = mapStatus(task.status);
  const statusFieldId = state.fields['Status'];
  const statusOptionId = state.statusOptions[statusLabel];
  if (statusFieldId && statusOptionId) {
    fieldUpdates.push(updateSingleSelectField(projectId, itemId, statusFieldId, statusOptionId));
  }

  // Execute all field updates in parallel
  await Promise.all(fieldUpdates);
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

  // Get current HEAD SHA for commit references in issue bodies
  const repoUrl = `https://github.com/${state.repository.owner}/${state.repository.name}`;
  let headSha = '';
  try {
    const { stdout } = await execAsync('git rev-parse HEAD');
    headSha = stdout.trim();
  } catch { /* not in a git repo or no commits */ }

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

  // Always refresh select-field option IDs from the live project.
  // GitHub reassigns ALL option IDs when updateFieldOptions is called,
  // so cached IDs in the sync state file can become stale.
  if (!options.dryRun) {
    await refreshSelectOptions(state);
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
      const ownerItems = state.items.filter(item => item.lastOwner && item.githubItemId);
      await pMap(ownerItems, async (item) => {
        try {
          await setOwnerField(state, item.githubItemId, item.lastOwner!);
        } catch {
          // Best effort — don't fail the whole sync
        }
      }, 5);
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

  // Group new tasks by dependency level for parallel creation within each level
  const depLevels: Array<Array<{ task: Task; teamName: string }>> = [];
  const taskLevel = new Map<string, number>();
  for (const entry of sortedNewEntries) {
    let level = 0;
    if (entry.task.blockedBy) {
      for (const depId of entry.task.blockedBy) {
        const depKey = `${entry.teamName}:${depId}`;
        // Only count deps that are in the new entries set (others already exist)
        const depLvl = taskLevel.get(depKey);
        if (depLvl !== undefined) {
          level = Math.max(level, depLvl + 1);
        }
      }
    }
    const key = `${entry.teamName}:${entry.task.id}`;
    taskLevel.set(key, level);
    while (depLevels.length <= level) depLevels.push([]);
    depLevels[level].push(entry);
  }

  // Helper to create a single issue
  async function createSingleIssue(task: Task, teamName: string): Promise<void> {
    const title = mapTitle(task);
    const body = mapBody(task, teamName, headSha ? { repoUrl, commitSha: headSha } : undefined);

    if (options.dryRun) {
      if (!options.quiet) logger.info(`[dry-run] Would create: ${title}`);
      result.created++;
      return;
    }

    try {
      // Ensure team label exists
      let labelId: string | undefined;
      try {
        labelId = await ensureTeamLabel(state!, teamName);
      } catch {
        logger.warn(`Could not create/find label for team "${teamName}", skipping label`);
      }

      // Resolve parentIssueId from blockedBy (same team only)
      let parentIssueId: string | undefined;
      if (task.blockedBy && task.blockedBy.length > 0) {
        const parentTaskId = task.blockedBy[0];
        const parentMapping = findMapping(state!, parentTaskId, teamName);
        if (parentMapping?.issueNodeId) {
          parentIssueId = parentMapping.issueNodeId;
        }
      }

      // Create real issue in repository
      const issue = await createIssue({
        repositoryId: state!.repository.id,
        title,
        body,
        labelIds: labelId ? [labelId] : undefined,
        projectIds: [state!.project.id],
        parentIssueId,
      });

      // Get project item ID for setting custom fields
      let itemId: string;
      try {
        itemId = await addProjectV2ItemById(state!.project.id, issue.id);
      } catch {
        logger.warn(`Could not get project item ID for issue #${issue.number}, skipping custom fields`);
        itemId = '';
      }

      // Set custom fields on the project item
      const effectiveOwner = task.owner || '';
      if (itemId) {
        await setAllFields(state!, itemId, task, teamName, effectiveOwner);
      }

      const hash = computeTaskHash(task, teamName);
      upsertMapping(state!, {
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

  // Create new issues level by level (parallel within each level, sequential between levels)
  for (const levelEntries of depLevels) {
    await pMap(levelEntries, ({ task, teamName }) => createSingleIssue(task, teamName), 5);
  }

  // Collect items that need updating vs skipped
  const updateEntries: Array<{ item: typeof scopedItems[0]; task: Task; teamName: string; hash: string }> = [];
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

    if (options.dryRun) {
      if (!options.quiet) logger.info(`[dry-run] Would update: ${mapTitle(task)}`);
      result.updated++;
      continue;
    }

    updateEntries.push({ item, task, teamName, hash });
  }

  // Update changed items in parallel (concurrency limit 5)
  await pMap(updateEntries, async ({ item, task, teamName, hash }) => {
    const title = mapTitle(task);
    const body = mapBody(task, teamName, headSha ? { repoUrl, commitSha: headSha } : undefined);

    try {
      // Update the real issue
      if (item.issueNodeId) {
        await updateIssue(item.issueNodeId, title, body);

        // Ensure label is applied (may have been missed on initial creation)
        try {
          const labelId = await ensureTeamLabel(state!, teamName);
          await ensureLabelsOnIssue(item.issueNodeId, [labelId]);
        } catch { /* best effort */ }
      }

      // Update project item custom fields
      const effectiveOwner = task.owner || item.lastOwner || '';
      if (item.githubItemId) {
        await setAllFields(state!, item.githubItemId, task, teamName, effectiveOwner);
      }

      upsertMapping(state!, {
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
  }, 5);

  // Note: Issues whose tasks have been removed from disk are intentionally
  // kept open so that historical records remain visible on the project board.
  // Use `ccteams close` or `ccteams reset` to explicitly close/archive issues.

  // Create/update team summary issue with branch link
  if (!options.dryRun) {
    for (const [teamName, tasks] of tasksByTeam) {
      await createTeamSummary(state, teamName, tasks, options.quiet);
    }
  }

  // Save updated state
  if (!options.dryRun) {
    await saveSyncState(state);
  }

  return result;
  }); // end withLock
}

/**
 * Create or update a single summary issue per team.
 * Pushes current HEAD to a remote branch and links it in the issue body.
 */
async function createTeamSummary(
  state: SyncStateData,
  teamName: string,
  tasks: Task[],
  quiet?: boolean,
): Promise<void> {
  if (!state.summaryIssues) state.summaryIssues = {};

  // 1. Push local work to remote branch
  const branchName = `ccteams/${teamName}`;
  let branchOid = '';
  let branchPushed = false;
  try {
    await execAsync(`git push origin HEAD:refs/heads/${branchName} --force`);
    const { stdout } = await execAsync('git rev-parse HEAD');
    branchOid = stdout.trim();
    branchPushed = true;
    if (!quiet) logger.info(`Pushed branch: ${branchName} (${branchOid.slice(0, 7)})`);
  } catch {
    // git push failed — fall back to creating empty branch from default branch
    try {
      branchOid = await getDefaultBranchOid(state.repository.owner, state.repository.name);
    } catch {
      logger.warn(`Could not push or create branch "${branchName}", skipping`);
    }
  }

  // 2. Build summary body
  const branchUrl = `https://github.com/${state.repository.owner}/${state.repository.name}/tree/${branchName}`;
  const lines: string[] = [];
  lines.push(`## ${teamName}`);
  lines.push('');
  if (branchOid) {
    lines.push(`**Branch:** [\`${branchName}\`](${branchUrl})`);
  }
  lines.push(`**Last Synced:** ${new Date().toISOString()}`);
  lines.push(`**Tasks:** ${tasks.length}`);
  lines.push('');
  lines.push('| Issue | Task | Status | Owner |');
  lines.push('|-------|------|--------|-------|');
  for (const task of tasks) {
    const mapping = findMapping(state, task.id, teamName);
    const issueRef = mapping ? `#${mapping.issueNumber}` : '-';
    lines.push(`| ${issueRef} | ${task.subject} | ${task.status} | ${task.owner || '-'} |`);
  }

  const title = `[ccteams] ${teamName} — Work Summary`;
  const body = lines.join('\n');

  // 3. Create or update summary issue, then link branch
  let labelId: string | undefined;
  try { labelId = await ensureTeamLabel(state, teamName); } catch { /* skip */ }

  const existing = state.summaryIssues[teamName];
  try {
    let issueNodeId: string;

    let summaryItemId: string | undefined;

    if (existing) {
      issueNodeId = existing.issueNodeId;
      summaryItemId = existing.githubItemId;
      await updateIssue(issueNodeId, title, body);

      // Ensure label is applied (may have been missed on initial creation)
      if (labelId) {
        try { await ensureLabelsOnIssue(issueNodeId, [labelId]); } catch { /* best effort */ }
      }

      // Recover githubItemId if missing (e.g. upgraded from older sync state)
      if (!summaryItemId) {
        try {
          summaryItemId = await addProjectV2ItemById(state.project.id, issueNodeId);
          existing.githubItemId = summaryItemId;
        } catch { /* best effort */ }
      }

      if (!quiet) logger.success(`Updated summary: ${title} (#${existing.issueNumber})`);
    } else {
      const issue = await createIssue({
        repositoryId: state.repository.id,
        title,
        body,
        labelIds: labelId ? [labelId] : undefined,
        projectIds: [state.project.id],
      });
      issueNodeId = issue.id;

      try {
        summaryItemId = await addProjectV2ItemById(state.project.id, issue.id);
        const teamFieldId = state.fields['Team Name'];
        if (teamFieldId) {
          await updateTextField(state.project.id, summaryItemId, teamFieldId, teamName);
        }
      } catch { /* best effort */ }

      state.summaryIssues[teamName] = {
        issueNodeId: issue.id,
        issueNumber: issue.number,
        githubItemId: summaryItemId,
      };
      if (!quiet) logger.success(`Created summary: ${title} (#${issue.number})`);
    }

    // 4. Set summary Status based on task completion
    if (summaryItemId) {
      const allDone = tasks.length > 0 && tasks.every(t => t.status === 'completed');
      const anyInProgress = tasks.some(t => t.status === 'in_progress');
      const summaryStatus = allDone ? 'Done' : anyInProgress ? 'In Progress' : 'Todo';

      const statusFieldId = state.fields['Status'];
      const statusOptionId = state.statusOptions[summaryStatus];
      if (statusFieldId && statusOptionId) {
        try {
          await updateSingleSelectField(state.project.id, summaryItemId, statusFieldId, statusOptionId);
        } catch { /* best effort */ }
      }
    }

    // 5. Ensure branch is linked to the summary issue (Development panel)
    if (branchOid) {
      try {
        const alreadyLinked = await isBranchLinkedToIssue(issueNodeId, branchName);
        if (!alreadyLinked) {
          // Branch was pushed via git but not yet linked — link it now.
          // linkExistingBranchToIssue deletes the ref temporarily, then
          // recreates it via createLinkedBranch which links + creates atomically.
          await linkExistingBranchToIssue(
            state.repository.owner, state.repository.name,
            state.repository.id, issueNodeId, branchName, branchOid,
          );
          // Re-push to ensure the ref points to latest HEAD (not just the OID
          // used for createLinkedBranch, which may be stale if HEAD moved).
          if (branchPushed) {
            try { await execAsync(`git push origin HEAD:refs/heads/${branchName} --force`); } catch { /* best effort */ }
          }
          if (!quiet) logger.info(`Linked branch: ${branchName}`);
        }
      } catch {
        logger.warn(`Could not link branch "${branchName}" to summary issue`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to create/update summary: ${msg}`);
  }
}
