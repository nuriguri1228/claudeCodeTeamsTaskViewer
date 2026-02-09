import { runGraphQL } from '../utils/gh-auth.js';
import { withRetry } from '../utils/retry.js';
import { ProjectInfo, ProjectField, SingleSelectOption, StatusFieldInfo, CreatedIssue } from '../types/github.js';

/**
 * Create a new GitHub Project V2
 */
export async function createProject(ownerId: string, title: string): Promise<ProjectInfo> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 {
            id
            number
            url
            title
          }
        }
      }
    `, { ownerId, title });

    const project = data.createProjectV2.projectV2;
    return {
      id: project.id,
      number: project.number,
      url: project.url,
      title: project.title,
      owner: '', // will be filled by caller
    };
  }, 'Create project');
}

/**
 * Get the owner node ID (user or org) for creating a project
 */
export async function getOwnerNodeId(owner: string): Promise<string> {
  return withRetry(async () => {
    // Try user first
    try {
      const data = await runGraphQL(`
        query($login: String!) {
          user(login: $login) { id }
        }
      `, { login: owner });
      return data.user.id;
    } catch {
      // Try organization
      const data = await runGraphQL(`
        query($login: String!) {
          organization(login: $login) { id }
        }
      `, { login: owner });
      return data.organization.id;
    }
  }, 'Get owner node ID');
}

/**
 * Get the repository node ID
 */
export async function getRepoId(owner: string, name: string): Promise<string> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) { id }
      }
    `, { owner, name });
    return data.repository.id;
  }, 'Get repository ID');
}

/**
 * Link a Project V2 to a repository
 */
export async function linkProjectToRepo(projectId: string, repositoryId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
          repository { id }
        }
      }
    `, { projectId, repositoryId });
  }, 'Link project to repository');
}

/**
 * Create a custom field (TEXT type) on a project
 */
export async function createTextField(projectId: string, name: string): Promise<string> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!) {
        createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType }) {
          projectV2Field { ... on ProjectV2Field { id } }
        }
      }
    `, { projectId, name, dataType: 'TEXT' });
    return data.createProjectV2Field.projectV2Field.id;
  }, `Create field "${name}"`);
}

/**
 * Create a custom SINGLE_SELECT field on a project
 */
export async function createSingleSelectField(projectId: string, name: string, options: Array<{ name: string; color: string; description: string }>): Promise<string> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
        createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType, singleSelectOptions: $options }) {
          projectV2Field { ... on ProjectV2SingleSelectField { id } }
        }
      }
    `, { projectId, name, dataType: 'SINGLE_SELECT', options });
    return data.createProjectV2Field.projectV2Field.id;
  }, `Create single-select field "${name}"`);
}

/**
 * Update the options of a SINGLE_SELECT field (replaces all options)
 */
export async function updateFieldOptions(fieldId: string, options: Array<{ name: string; color: string; description: string }>): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
          projectV2Field { ... on ProjectV2SingleSelectField { id } }
        }
      }
    `, { fieldId, options });
  }, 'Update field options');
}

/**
 * Get all fields of a project, including the Status field options
 */
export async function getProjectFields(projectId: string): Promise<{ fields: ProjectField[]; statusField: StatusFieldInfo | null }> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options { id name }
                }
              }
            }
          }
        }
      }
    `, { projectId });

    const nodes = data.node.fields.nodes;
    const fields: ProjectField[] = [];
    let statusField: StatusFieldInfo | null = null;

    for (const node of nodes) {
      if (!node.id) continue;
      fields.push({
        id: node.id,
        name: node.name,
        dataType: node.dataType,
      });

      if (node.name === 'Status' && node.options) {
        statusField = {
          fieldId: node.id,
          options: node.options as SingleSelectOption[],
        };
      }
    }

    return { fields, statusField };
  }, 'Get project fields');
}

/**
 * Create a real Issue in a repository, optionally adding it to projects and setting a parent issue.
 */
export async function createIssue(options: {
  repositoryId: string;
  title: string;
  body: string;
  labelIds?: string[];
  projectIds?: string[];
  parentIssueId?: string;
}): Promise<CreatedIssue> {
  return withRetry(async () => {
    // Build the input dynamically to avoid sending null/undefined
    const inputParts = [
      '$repositoryId: ID!',
      '$title: String!',
      '$body: String!',
    ];
    const inputFields = [
      'repositoryId: $repositoryId',
      'title: $title',
      'body: $body',
    ];
    const variables: Record<string, unknown> = {
      repositoryId: options.repositoryId,
      title: options.title,
      body: options.body,
    };

    if (options.labelIds && options.labelIds.length > 0) {
      inputParts.push('$labelIds: [ID!]');
      inputFields.push('labelIds: $labelIds');
      variables.labelIds = options.labelIds;
    }

    if (options.projectIds && options.projectIds.length > 0) {
      inputParts.push('$projectIds: [ID!]');
      inputFields.push('projectV2Ids: $projectIds');
      variables.projectIds = options.projectIds;
    }

    if (options.parentIssueId) {
      inputParts.push('$parentIssueId: ID!');
      inputFields.push('parentIssueId: $parentIssueId');
      variables.parentIssueId = options.parentIssueId;
    }

    const mutation = `
      mutation(${inputParts.join(', ')}) {
        createIssue(input: { ${inputFields.join(', ')} }) {
          issue {
            id
            number
            url
            title
          }
        }
      }
    `;

    const data = await runGraphQL(mutation, variables);
    const issue = data.createIssue.issue;
    return {
      id: issue.id,
      number: issue.number,
      url: issue.url,
      title: issue.title,
    };
  }, 'Create issue');
}

/**
 * Update an existing Issue's title and body
 */
export async function updateIssue(issueId: string, title: string, body: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($issueId: ID!, $title: String!, $body: String!) {
        updateIssue(input: { id: $issueId, title: $title, body: $body }) {
          issue { id }
        }
      }
    `, { issueId, title, body });
  }, 'Update issue');
}

/**
 * Close an issue
 */
export async function closeIssue(issueId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($issueId: ID!, $stateReason: IssueClosedStateReason!) {
        closeIssue(input: { issueId: $issueId, stateReason: $stateReason }) {
          issue { id }
        }
      }
    `, { issueId, stateReason: 'COMPLETED' });
  }, 'Close issue');
}

/**
 * Add an existing Issue to a Project V2 and return the project item ID
 */
export async function addProjectV2ItemById(projectId: string, contentId: string): Promise<string> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }
    `, { projectId, contentId });
    return data.addProjectV2ItemById.item.id;
  }, 'Add item to project');
}

/**
 * Create a label in a repository (if it doesn't already exist)
 */
export async function createLabel(repositoryId: string, name: string, color: string): Promise<string> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      mutation($repositoryId: ID!, $name: String!, $color: String!) {
        createLabel(input: { repositoryId: $repositoryId, name: $name, color: $color }) {
          label { id }
        }
      }
    `, { repositoryId, name, color });
    return data.createLabel.label.id;
  }, `Create label "${name}"`);
}

/**
 * Add labels to an issue (labelable)
 */
export async function addLabelsToIssue(issueId: string, labelIds: string[]): Promise<void> {
  if (labelIds.length === 0) return;
  await withRetry(async () => {
    await runGraphQL(`
      mutation($labelableId: ID!, $labelIds: [ID!]!) {
        addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
          labelable { __typename }
        }
      }
    `, { labelableId: issueId, labelIds });
  }, 'Add labels to issue');
}

/**
 * Get labels from a repository matching a prefix
 */
export async function getRepoLabels(owner: string, repoName: string, prefix: string): Promise<Array<{ id: string; name: string }>> {
  return withRetry(async () => {
    const data = await runGraphQL(`
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          labels(first: 100) {
            nodes { id name }
          }
        }
      }
    `, { owner, name: repoName });
    const labels = data.repository.labels.nodes as Array<{ id: string; name: string }>;
    return labels.filter(l => l.name.startsWith(prefix));
  }, 'Get repo labels');
}

/**
 * Update a text field value on a project item
 */
export async function updateTextField(projectId: string, itemId: string, fieldId: string, value: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { text: $value }
        }) {
          projectV2Item { id }
        }
      }
    `, { projectId, itemId, fieldId, value });
  }, 'Update text field');
}

/**
 * Update a single select field value on a project item (e.g., Status)
 */
export async function updateSingleSelectField(projectId: string, itemId: string, fieldId: string, optionId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item { id }
        }
      }
    `, { projectId, itemId, fieldId, optionId });
  }, 'Update single select field');
}

/**
 * Close a GitHub Project V2 (set closed: true, project is preserved)
 */
export async function closeProject(projectId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!) {
        updateProjectV2(input: { projectId: $projectId, closed: true }) {
          projectV2 { id }
        }
      }
    `, { projectId });
  }, 'Close project');
}

/**
 * Delete a GitHub Project V2
 */
export async function deleteProject(projectId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!) {
        deleteProjectV2(input: { projectId: $projectId }) {
          projectV2 { id }
        }
      }
    `, { projectId });
  }, 'Delete project');
}

/**
 * Archive a project item
 */
export async function archiveItem(projectId: string, itemId: string): Promise<void> {
  await withRetry(async () => {
    await runGraphQL(`
      mutation($projectId: ID!, $itemId: ID!) {
        archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          item { id }
        }
      }
    `, { projectId, itemId });
  }, 'Archive item');
}
