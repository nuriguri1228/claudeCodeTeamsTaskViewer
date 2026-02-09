import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const HOOK_ENTRY = {
  matcher: 'TaskCreate|TaskUpdate',
  command: 'ccteams sync --quiet',
  async: true,
};

function getSettingsPath(local: boolean): string {
  if (local) {
    return join(process.cwd(), '.claude', 'settings.json');
  }
  return join(homedir(), '.claude', 'settings.json');
}

async function readSettings(path: string): Promise<Record<string, any>> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSettings(path: string, settings: Record<string, any>): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

function isCcteamsHook(hook: any): boolean {
  return (
    hook &&
    typeof hook.command === 'string' &&
    hook.command.startsWith('ccteams')
  );
}

export async function hooksInstallCommand(options: { local?: boolean }): Promise<void> {
  const local = options.local ?? false;
  const settingsPath = getSettingsPath(local);

  logger.info(`Installing hook in: ${settingsPath}`);

  const settings = await readSettings(settingsPath);

  // Ensure hooks.PostToolUse array exists
  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = [];
  }

  // Check if already installed
  const existing = settings.hooks.PostToolUse.find(isCcteamsHook);
  if (existing) {
    logger.warn('Hook is already installed.');
    return;
  }

  settings.hooks.PostToolUse.push(HOOK_ENTRY);
  await writeSettings(settingsPath, settings);

  logger.success('Hook installed successfully.');
  logger.dim('ccteams sync will run automatically on TaskCreate and TaskUpdate.');
}

export async function hooksUninstallCommand(options: { local?: boolean }): Promise<void> {
  const local = options.local ?? false;
  const settingsPath = getSettingsPath(local);

  logger.info(`Removing hook from: ${settingsPath}`);

  const settings = await readSettings(settingsPath);

  if (!settings.hooks?.PostToolUse) {
    logger.warn('No hooks found to uninstall.');
    return;
  }

  const before = settings.hooks.PostToolUse.length;
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (hook: any) => !isCcteamsHook(hook),
  );
  const after = settings.hooks.PostToolUse.length;

  if (before === after) {
    logger.warn('No ccteams hook found to remove.');
    return;
  }

  // Clean up empty arrays/objects
  if (settings.hooks.PostToolUse.length === 0) {
    delete settings.hooks.PostToolUse;
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  await writeSettings(settingsPath, settings);

  logger.success('Hook uninstalled successfully.');
}
