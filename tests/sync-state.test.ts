import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SyncStateData, ItemMapping } from '../src/types/sync.js';
import {
  createInitialSyncState,
  loadSyncState,
  saveSyncState,
  findMapping,
  upsertMapping,
  removeMapping,
} from '../src/core/sync-state.js';

let tempDir: string;

vi.mock('../src/utils/paths.js', () => ({
  getSyncFilePath: () => join(tempDir, '.ccteams-sync.json'),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
  },
}));

function makeSampleState(): SyncStateData {
  return {
    project: {
      id: 'PVT_123',
      number: 1,
      url: 'https://github.com/orgs/test/projects/1',
      title: 'Test Project',
      owner: 'test-org',
    },
    repository: {
      id: 'R_123',
      owner: 'test-org',
      name: 'test-repo',
    },
    fields: { Status: 'FIELD_1', 'Team Name': 'FIELD_2' },
    statusOptions: { Todo: 'OPT_1', 'In Progress': 'OPT_2', Done: 'OPT_3' },
    ownerOptions: {},
    labels: {},
    items: [],
    lastSyncAt: '2025-01-01T00:00:00.000Z',
  };
}

function makeSampleMapping(overrides: Partial<ItemMapping> = {}): ItemMapping {
  return {
    taskId: '1',
    teamName: 'test-team',
    githubItemId: 'PVTI_100',
    contentId: 'I_100',
    issueNodeId: 'I_100',
    issueNumber: 1,
    lastHash: 'abc123',
    lastSyncedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ccteams-sync-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('createInitialSyncState', () => {
  it('should create a state with the given project, fields, status options, and repository', () => {
    const project = {
      id: 'PVT_456',
      number: 2,
      url: 'https://github.com/orgs/acme/projects/2',
      title: 'Acme Board',
      owner: 'acme',
    };
    const fields = { Status: 'F1', Title: 'F2' };
    const statusOptions = { Todo: 'S1', Done: 'S2' };
    const repository = { id: 'R_789', owner: 'acme', name: 'tasks' };

    const state = createInitialSyncState(project, fields, statusOptions, repository);

    expect(state.project).toEqual(project);
    expect(state.fields).toEqual(fields);
    expect(state.statusOptions).toEqual(statusOptions);
    expect(state.repository).toEqual(repository);
    expect(state.ownerOptions).toEqual({});
    expect(state.labels).toEqual({});
    expect(state.items).toEqual([]);
    expect(state.lastSyncAt).toBeDefined();
  });
});

describe('loadSyncState / saveSyncState', () => {
  it('should return null when sync file does not exist', async () => {
    const result = await loadSyncState();
    expect(result).toBeNull();
  });

  it('should save and then load state correctly', async () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping());

    await saveSyncState(state);

    const loaded = await loadSyncState();
    expect(loaded).not.toBeNull();
    expect(loaded!.project.id).toBe('PVT_123');
    expect(loaded!.items).toHaveLength(1);
    expect(loaded!.items[0].taskId).toBe('1');
  });

  it('should update lastSyncAt on save', async () => {
    const state = makeSampleState();
    const originalTime = state.lastSyncAt;

    await saveSyncState(state);

    const raw = await readFile(join(tempDir, '.ccteams-sync.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.lastSyncAt).not.toBe(originalTime);
  });

  it('should write pretty-printed JSON', async () => {
    const state = makeSampleState();
    await saveSyncState(state);

    const raw = await readFile(join(tempDir, '.ccteams-sync.json'), 'utf-8');
    // Pretty-printed JSON has newlines
    expect(raw.split('\n').length).toBeGreaterThan(3);
    // File ends with newline
    expect(raw.endsWith('\n')).toBe(true);
  });
});

describe('findMapping', () => {
  it('should find a mapping by taskId and teamName', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));
    state.items.push(makeSampleMapping({ taskId: '2', teamName: 'alpha' }));

    const found = findMapping(state, '2', 'alpha');
    expect(found).toBeDefined();
    expect(found!.taskId).toBe('2');
  });

  it('should return undefined when no match exists', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));

    const found = findMapping(state, '99', 'alpha');
    expect(found).toBeUndefined();
  });

  it('should distinguish by teamName', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));

    const found = findMapping(state, '1', 'beta');
    expect(found).toBeUndefined();
  });
});

describe('upsertMapping', () => {
  it('should insert a new mapping when none exists', () => {
    const state = makeSampleState();
    const mapping = makeSampleMapping({ taskId: '1', teamName: 'alpha' });

    upsertMapping(state, mapping);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(mapping);
  });

  it('should update an existing mapping', () => {
    const state = makeSampleState();
    const original = makeSampleMapping({ taskId: '1', teamName: 'alpha', lastHash: 'old' });
    state.items.push(original);

    const updated = makeSampleMapping({ taskId: '1', teamName: 'alpha', lastHash: 'new' });
    upsertMapping(state, updated);

    expect(state.items).toHaveLength(1);
    expect(state.items[0].lastHash).toBe('new');
  });

  it('should not affect other mappings when upserting', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));
    state.items.push(makeSampleMapping({ taskId: '2', teamName: 'alpha' }));

    const updated = makeSampleMapping({ taskId: '1', teamName: 'alpha', lastHash: 'changed' });
    upsertMapping(state, updated);

    expect(state.items).toHaveLength(2);
    expect(state.items.find(i => i.taskId === '2')!.lastHash).toBe('abc123');
  });
});

describe('removeMapping', () => {
  it('should remove a mapping by taskId and teamName', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));
    state.items.push(makeSampleMapping({ taskId: '2', teamName: 'alpha' }));

    removeMapping(state, '1', 'alpha');

    expect(state.items).toHaveLength(1);
    expect(state.items[0].taskId).toBe('2');
  });

  it('should do nothing when mapping does not exist', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));

    removeMapping(state, '99', 'alpha');

    expect(state.items).toHaveLength(1);
  });

  it('should only remove the exact match (same taskId + teamName)', () => {
    const state = makeSampleState();
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'alpha' }));
    state.items.push(makeSampleMapping({ taskId: '1', teamName: 'beta' }));

    removeMapping(state, '1', 'alpha');

    expect(state.items).toHaveLength(1);
    expect(state.items[0].teamName).toBe('beta');
  });
});
