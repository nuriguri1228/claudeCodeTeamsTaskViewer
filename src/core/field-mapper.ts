import { createHash } from 'node:crypto';
import { Task } from '../types/claude.js';
import { STATUS_MAP } from '../constants.js';

/**
 * Generate the title for a GitHub draft issue from a task
 */
export function mapTitle(task: Task): string {
  return `[${task.id}] ${task.subject}`;
}

/**
 * Generate the body for a GitHub draft issue from a task
 */
export function mapBody(task: Task, teamName: string, branchName?: string): string {
  const lines: string[] = [];

  if (task.description) {
    lines.push(task.description);
    lines.push('');
  }

  lines.push('---');
  lines.push(`**Team:** ${teamName}`);
  lines.push(`**Task ID:** ${task.id}`);
  lines.push(`**Status:** ${task.status}`);

  if (task.owner) {
    lines.push(`**Owner:** ${task.owner}`);
  }
  if (task.activeForm) {
    lines.push(`**Active Form:** ${task.activeForm}`);
  }
  if (task.blockedBy && task.blockedBy.length > 0) {
    lines.push(`**Blocked By:** ${task.blockedBy.join(', ')}`);
  }
  if (task.blocks && task.blocks.length > 0) {
    lines.push(`**Blocks:** ${task.blocks.join(', ')}`);
  }
  if (branchName) {
    lines.push(`**Branch:** \`${branchName}\``);
  }

  return lines.join('\n');
}

/**
 * Map Claude task status to GitHub project status label
 */
export function mapStatus(status: Task['status']): string {
  return STATUS_MAP[status] ?? 'Todo';
}

/**
 * Build a record of field name -> value for GitHub project custom fields
 */
export function mapCustomFields(task: Task, teamName: string): Record<string, string> {
  return {
    'Team Name': teamName,
    'Agent (Owner)': task.owner ?? '',
    'Task ID': task.id,
    'Blocked By': (task.blockedBy ?? []).join(', '),
    'Active Form': task.activeForm ?? '',
  };
}

/**
 * Compute a SHA-256 hash of the relevant task fields for change detection.
 * Only fields that affect the GitHub project item are included.
 */
export function computeTaskHash(task: Task, teamName: string): string {
  const normalized = {
    subject: task.subject,
    description: task.description ?? '',
    status: task.status,
    owner: task.owner ?? '',
    activeForm: task.activeForm ?? '',
    blockedBy: (task.blockedBy ?? []).sort(),
    blocks: (task.blocks ?? []).sort(),
    teamName,
  };

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}
