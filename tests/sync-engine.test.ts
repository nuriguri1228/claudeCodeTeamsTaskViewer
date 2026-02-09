import { describe, it, expect } from 'vitest';
import type { Task } from '../src/types/claude.js';
import {
  mapTitle,
  mapBody,
  mapStatus,
  mapCustomFields,
  computeTaskHash,
} from '../src/core/field-mapper.js';

function makePendingTask(): Task {
  return {
    id: '1',
    subject: 'Research the codebase',
    description: 'Explore and understand the project structure',
    status: 'pending',
    blockedBy: [],
    blocks: ['2'],
  };
}

function makeInProgressTask(): Task {
  return {
    id: '2',
    subject: 'Implement feature X',
    description: 'Build the core feature based on research',
    status: 'in_progress',
    owner: 'coder',
    activeForm: 'Implementing feature X',
    blockedBy: ['1'],
    blocks: ['3'],
  };
}

function makeCompletedTask(): Task {
  return {
    id: '3',
    subject: 'Write tests',
    description: 'Create unit tests for the feature',
    status: 'completed',
    owner: 'coder',
    blockedBy: ['2'],
  };
}

describe('mapTitle', () => {
  it('should produce "[id] subject" format', () => {
    const task = makePendingTask();
    expect(mapTitle(task)).toBe('[1] Research the codebase');
  });

  it('should work with different task IDs', () => {
    const task = makeInProgressTask();
    expect(mapTitle(task)).toBe('[2] Implement feature X');
  });
});

describe('mapBody', () => {
  it('should include description', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).toContain('Explore and understand the project structure');
  });

  it('should include team name', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).toContain('**Team:** test-team');
  });

  it('should include task ID', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).toContain('**Task ID:** 1');
  });

  it('should include status', () => {
    const body = mapBody(makeInProgressTask(), 'test-team');
    expect(body).toContain('**Status:** in_progress');
  });

  it('should include owner when present', () => {
    const body = mapBody(makeInProgressTask(), 'test-team');
    expect(body).toContain('**Owner:** coder');
  });

  it('should not include owner when absent', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).not.toContain('**Owner:**');
  });

  it('should include activeForm when present', () => {
    const body = mapBody(makeInProgressTask(), 'test-team');
    expect(body).toContain('**Active Form:** Implementing feature X');
  });

  it('should include blockedBy when non-empty', () => {
    const body = mapBody(makeInProgressTask(), 'test-team');
    expect(body).toContain('**Blocked By:** 1');
  });

  it('should not include blockedBy when empty', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).not.toContain('**Blocked By:**');
  });

  it('should include blocks when non-empty', () => {
    const body = mapBody(makePendingTask(), 'test-team');
    expect(body).toContain('**Blocks:** 2');
  });
});

describe('mapStatus', () => {
  it('should map pending to Todo', () => {
    expect(mapStatus('pending')).toBe('Todo');
  });

  it('should map in_progress to In Progress', () => {
    expect(mapStatus('in_progress')).toBe('In Progress');
  });

  it('should map completed to Done', () => {
    expect(mapStatus('completed')).toBe('Done');
  });
});

describe('mapCustomFields', () => {
  it('should return Team Name', () => {
    const fields = mapCustomFields(makePendingTask(), 'alpha');
    expect(fields['Team Name']).toBe('alpha');
  });

  it('should return Agent (Owner) as empty string when no owner', () => {
    const fields = mapCustomFields(makePendingTask(), 'alpha');
    expect(fields['Agent (Owner)']).toBe('');
  });

  it('should return Agent (Owner) when owner is set', () => {
    const fields = mapCustomFields(makeInProgressTask(), 'alpha');
    expect(fields['Agent (Owner)']).toBe('coder');
  });

  it('should return Task ID', () => {
    const fields = mapCustomFields(makeInProgressTask(), 'alpha');
    expect(fields['Task ID']).toBe('2');
  });

  it('should return Blocked By as comma-separated list', () => {
    const task: Task = {
      id: '5',
      subject: 'Multi blocked',
      description: '',
      status: 'pending',
      blockedBy: ['1', '3'],
    };
    const fields = mapCustomFields(task, 'alpha');
    expect(fields['Blocked By']).toBe('1, 3');
  });

  it('should return Active Form when present', () => {
    const fields = mapCustomFields(makeInProgressTask(), 'alpha');
    expect(fields['Active Form']).toBe('Implementing feature X');
  });

  it('should return Active Form as empty string when absent', () => {
    const fields = mapCustomFields(makePendingTask(), 'alpha');
    expect(fields['Active Form']).toBe('');
  });
});

describe('computeTaskHash', () => {
  it('should produce a hex string', () => {
    const hash = computeTaskHash(makePendingTask(), 'test-team');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce the same hash for the same input', () => {
    const hash1 = computeTaskHash(makePendingTask(), 'test-team');
    const hash2 = computeTaskHash(makePendingTask(), 'test-team');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash when subject changes', () => {
    const task1 = makePendingTask();
    const task2 = { ...makePendingTask(), subject: 'Different subject' };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when status changes', () => {
    const task1 = makePendingTask();
    const task2: Task = { ...makePendingTask(), status: 'completed' };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when owner changes', () => {
    const task1 = makePendingTask();
    const task2 = { ...makePendingTask(), owner: 'new-owner' };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when description changes', () => {
    const task1 = makePendingTask();
    const task2 = { ...makePendingTask(), description: 'Changed description' };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when teamName changes', () => {
    const task = makePendingTask();
    expect(computeTaskHash(task, 'team-a')).not.toBe(computeTaskHash(task, 'team-b'));
  });

  it('should produce different hash when blockedBy changes', () => {
    const task1 = makePendingTask();
    const task2 = { ...makePendingTask(), blockedBy: ['99'] };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when blocks changes', () => {
    const task1 = makePendingTask();
    const task2 = { ...makePendingTask(), blocks: ['99'] };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should produce different hash when activeForm changes', () => {
    const task1 = makeInProgressTask();
    const task2 = { ...makeInProgressTask(), activeForm: 'Doing something else' };
    expect(computeTaskHash(task1, 'test-team')).not.toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should be order-independent for blockedBy', () => {
    const task1: Task = { ...makePendingTask(), blockedBy: ['1', '3', '2'] };
    const task2: Task = { ...makePendingTask(), blockedBy: ['3', '1', '2'] };
    expect(computeTaskHash(task1, 'test-team')).toBe(computeTaskHash(task2, 'test-team'));
  });

  it('should be order-independent for blocks', () => {
    const task1: Task = { ...makePendingTask(), blocks: ['5', '3'] };
    const task2: Task = { ...makePendingTask(), blocks: ['3', '5'] };
    expect(computeTaskHash(task1, 'test-team')).toBe(computeTaskHash(task2, 'test-team'));
  });
});
