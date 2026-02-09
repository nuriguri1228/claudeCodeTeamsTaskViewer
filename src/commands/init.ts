import { checkGhAuth, checkProjectScope } from '../utils/gh-auth.js';
import { createProject, getOwnerNodeId, createTextField, createSingleSelectField, getProjectFields, getRepoId, linkProjectToRepo } from '../core/github-project.js';
import { createInitialSyncState, saveSyncState } from '../core/sync-state.js';
import { CUSTOM_FIELDS } from '../constants.js';
import { logger } from '../utils/logger.js';

/**
 * Core init logic — reusable from both `ccteams init` and `autoCommand`.
 */
export async function performInit(options: {
  repoOwner: string;
  repoName: string;
  owner?: string;
  title?: string;
}): Promise<void> {
  const owner = options.owner ?? options.repoOwner;
  logger.info(`Using owner: ${owner}`);

  // Get repo ID
  logger.info(`Looking up repository: ${options.repoOwner}/${options.repoName}`);
  const repositoryId = await getRepoId(options.repoOwner, options.repoName);

  // Get owner node ID
  const ownerId = await getOwnerNodeId(owner);

  // Create project
  const projectTitle = options.title ?? 'Claude Code Teams Tasks';
  logger.info(`Creating project: ${projectTitle}`);
  const project = await createProject(ownerId, projectTitle);
  project.owner = owner;

  // Link project to repository
  logger.info(`Linking project to repository: ${options.repoOwner}/${options.repoName}`);
  await linkProjectToRepo(project.id, repositoryId);

  // Create custom fields
  const fieldsMap: Record<string, string> = {};
  for (const field of CUSTOM_FIELDS) {
    logger.info(`Creating field: ${field.name} (${field.dataType})`);
    let fieldId: string;
    if (field.dataType === 'SINGLE_SELECT') {
      fieldId = await createSingleSelectField(project.id, field.name, [
        { name: '(unassigned)', color: 'GRAY', description: '' },
      ]);
    } else {
      fieldId = await createTextField(project.id, field.name);
    }
    fieldsMap[field.name] = fieldId;
  }

  // Get project fields to retrieve Status field options
  const { fields: allFields, statusField } = await getProjectFields(project.id);

  // Add Status field ID to the fields map
  if (statusField) {
    fieldsMap['Status'] = statusField.fieldId;
  }

  // Build status options map
  const statusOptions: Record<string, string> = {};
  if (statusField) {
    for (const option of statusField.options) {
      statusOptions[option.name] = option.id;
    }
  }

  // Also pick up any built-in fields (like Title) that might be useful
  for (const field of allFields) {
    if (!fieldsMap[field.name]) {
      fieldsMap[field.name] = field.id;
    }
  }

  // Create and save initial sync state
  const state = createInitialSyncState(
    {
      id: project.id,
      number: project.number,
      url: project.url,
      title: project.title,
      owner: project.owner,
    },
    fieldsMap,
    statusOptions,
    {
      id: repositoryId,
      owner: options.repoOwner,
      name: options.repoName,
    },
  );
  await saveSyncState(state);

  logger.success(`Project created successfully!`);
  logger.info(`URL: ${project.url}`);
  logger.info(`Repository: ${options.repoOwner}/${options.repoName} (linked)`);
  logger.info(`Sync state saved to .ccteams-sync.json`);
}

export async function initCommand(options: { owner?: string; title?: string; repo?: string }): Promise<void> {
  // Check gh auth
  const isAuthed = await checkGhAuth();
  if (!isAuthed) {
    process.exit(1);
  }

  const hasScope = await checkProjectScope();
  if (!hasScope) {
    process.exit(1);
  }

  // Repo is required
  if (!options.repo) {
    logger.error('--repo <owner/repo> is required. Example: ccteams init --repo myuser/myrepo');
    process.exit(1);
  }

  // Parse repo
  const repoParts = options.repo.split('/');
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    logger.error('Invalid --repo format. Use owner/repo (e.g., myuser/myrepo)');
    process.exit(1);
  }
  const [repoOwner, repoName] = repoParts;

  await performInit({
    repoOwner,
    repoName,
    owner: options.owner,
    title: options.title,
  });

  logger.dim(`\nNext steps:`);
  logger.dim(`  1. Run 'ccteams sync' to sync your tasks as real Issues.`);
  logger.dim(`  2. In GitHub Project settings, switch to Board layout for kanban view.`);
  logger.dim(`  3. Use label filter (ccteams:<team>) to view tasks by team.`);
}
