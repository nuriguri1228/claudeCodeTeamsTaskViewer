import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { watchCommand } from './commands/watch.js';
import { hooksInstallCommand, hooksUninstallCommand } from './commands/hooks.js';
import { statusCommand } from './commands/status.js';
import { resetCommand } from './commands/reset.js';
import { closeCommand } from './commands/close.js';
import { autoCommand } from './commands/auto.js';

const program = new Command();

program
  .name('ccteams')
  .description('Claude Code Teams Task Viewer')
  .version('0.1.0');

// Default action: auto-init + sync
program.action(async () => {
  await autoCommand();
});

program
  .command('init')
  .description('Initialize a GitHub Project and sync state for ccteams')
  .requiredOption('--repo <owner/repo>', 'GitHub repository to link (e.g., myuser/myrepo)')
  .option('--owner <owner>', 'GitHub user or org to own the project (defaults to repo owner)')
  .option('--title <title>', 'Project title (default: "Claude Code Teams Tasks")')
  .action(async (opts) => {
    await initCommand({ owner: opts.owner, title: opts.title, repo: opts.repo });
  });

program
  .command('sync')
  .description('Sync task data from Claude Code sessions to GitHub Project')
  .option('--team <team>', 'Sync only a specific team')
  .option('--dry-run', 'Show what would be synced without making changes')
  .option('--quiet', 'Suppress output (useful for hook usage)')
  .action(async (opts) => {
    await syncCommand({ team: opts.team, dryRun: opts.dryRun, quiet: opts.quiet });
  });

program
  .command('watch')
  .description('Watch for task changes and sync automatically')
  .option('--team <team>', 'Watch only a specific team')
  .option('--debounce <ms>', 'Debounce interval in ms (default: 1000)', parseInt)
  .action(async (opts) => {
    await watchCommand({ team: opts.team, debounce: opts.debounce });
  });

const hooks = program
  .command('hooks')
  .description('Manage Claude Code hooks integration');

hooks
  .command('install')
  .description('Install a Claude Code hook to auto-sync on task changes')
  .option('--local', 'Install to local .claude/settings.json instead of global')
  .action(async (opts) => {
    await hooksInstallCommand({ local: opts.local });
  });

hooks
  .command('uninstall')
  .description('Remove the ccteams hook from Claude Code settings')
  .option('--local', 'Remove from local .claude/settings.json instead of global')
  .action(async (opts) => {
    await hooksUninstallCommand({ local: opts.local });
  });

program
  .command('status')
  .description('Show current sync status overview')
  .action(async () => {
    await statusCommand();
  });

program
  .command('close')
  .description('Close all tracked issues and the GitHub Project (project is preserved on GitHub)')
  .option('--force', 'Skip confirmation prompt')
  .action(async (opts) => {
    await closeCommand({ force: opts.force });
  });

program
  .command('reset')
  .description('Close all tracked issues, DELETE the GitHub Project, and remove sync state')
  .option('--force', 'Skip confirmation prompt')
  .action(async (opts) => {
    await resetCommand({ force: opts.force });
  });

export function main(): void {
  program.parse(process.argv);
}
