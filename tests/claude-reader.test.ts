import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readTeamConfig, readTeamTasks, listTeamNames } from '../src/core/claude-reader.js';

// Mock the paths module to use temp directories
let tempDir: string;

vi.mock('../src/utils/paths.js', () => ({
  getTeamConfigPath: (teamName: string) => join(tempDir, 'teams', teamName, 'config.json'),
  getTeamTasksDir: (teamName: string) => join(tempDir, 'tasks', teamName),
  getTasksDir: () => join(tempDir, 'tasks'),
}));

// Mock the logger to suppress output during tests
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

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ccteams-test-'));
  await mkdir(join(tempDir, 'teams'), { recursive: true });
  await mkdir(join(tempDir, 'tasks'), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('readTeamConfig', () => {
  it('should read and parse a valid team config', async () => {
    const teamDir = join(tempDir, 'teams', 'test-team');
    await mkdir(teamDir, { recursive: true });
    const config = {
      team_name: 'test-team',
      description: 'Test team for unit tests',
      members: [
        { name: 'researcher', agentId: 'researcher@test-team', agentType: 'general-purpose' },
      ],
    };
    await writeFile(join(teamDir, 'config.json'), JSON.stringify(config));

    const result = await readTeamConfig('test-team');
    expect(result).toEqual(config);
    expect(result?.team_name).toBe('test-team');
    expect(result?.members).toHaveLength(1);
  });

  it('should return null when config does not exist', async () => {
    const result = await readTeamConfig('nonexistent');
    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', async () => {
    const teamDir = join(tempDir, 'teams', 'bad-team');
    await mkdir(teamDir, { recursive: true });
    await writeFile(join(teamDir, 'config.json'), '{ invalid json }');

    const result = await readTeamConfig('bad-team');
    expect(result).toBeNull();
  });
});

describe('readTeamTasks', () => {
  it('should read all valid task files from a directory', async () => {
    const tasksDir = join(tempDir, 'tasks', 'test-team');
    await mkdir(tasksDir, { recursive: true });

    const task1 = { id: '1', subject: 'Task one', description: 'First', status: 'pending' };
    const task2 = { id: '2', subject: 'Task two', description: 'Second', status: 'completed' };
    await writeFile(join(tasksDir, 'task-1.json'), JSON.stringify(task1));
    await writeFile(join(tasksDir, 'task-2.json'), JSON.stringify(task2));

    const result = await readTeamTasks('test-team');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id).sort()).toEqual(['1', '2']);
  });

  it('should return empty array when tasks directory does not exist', async () => {
    const result = await readTeamTasks('nonexistent');
    expect(result).toEqual([]);
  });

  it('should skip invalid JSON files', async () => {
    const tasksDir = join(tempDir, 'tasks', 'test-team');
    await mkdir(tasksDir, { recursive: true });

    const validTask = { id: '1', subject: 'Valid task', description: 'OK', status: 'pending' };
    await writeFile(join(tasksDir, 'valid.json'), JSON.stringify(validTask));
    await writeFile(join(tasksDir, 'invalid.json'), '{ not valid json }');

    const result = await readTeamTasks('test-team');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('should skip task files missing required fields', async () => {
    const tasksDir = join(tempDir, 'tasks', 'test-team');
    await mkdir(tasksDir, { recursive: true });

    // Missing 'subject' field
    const incomplete = { id: '1', description: 'No subject' };
    await writeFile(join(tasksDir, 'incomplete.json'), JSON.stringify(incomplete));

    const result = await readTeamTasks('test-team');
    expect(result).toHaveLength(0);
  });

  it('should ignore non-JSON files', async () => {
    const tasksDir = join(tempDir, 'tasks', 'test-team');
    await mkdir(tasksDir, { recursive: true });

    const validTask = { id: '1', subject: 'A task', description: 'OK', status: 'pending' };
    await writeFile(join(tasksDir, 'task.json'), JSON.stringify(validTask));
    await writeFile(join(tasksDir, 'readme.txt'), 'Not a task');

    const result = await readTeamTasks('test-team');
    expect(result).toHaveLength(1);
  });
});

describe('listTeamNames', () => {
  it('should list team directory names', async () => {
    await mkdir(join(tempDir, 'tasks', 'alpha'), { recursive: true });
    await mkdir(join(tempDir, 'tasks', 'beta'), { recursive: true });

    const result = await listTeamNames();
    expect(result.sort()).toEqual(['alpha', 'beta']);
  });

  it('should return empty array when tasks directory does not exist', async () => {
    // Remove the tasks directory
    await rm(join(tempDir, 'tasks'), { recursive: true, force: true });

    const result = await listTeamNames();
    expect(result).toEqual([]);
  });

  it('should only include directories, not files', async () => {
    await mkdir(join(tempDir, 'tasks', 'team-a'), { recursive: true });
    await writeFile(join(tempDir, 'tasks', 'stray-file.json'), '{}');

    const result = await listTeamNames();
    expect(result).toEqual(['team-a']);
  });
});
