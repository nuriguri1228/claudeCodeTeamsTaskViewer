# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**ccteams** is a CLI tool that syncs Claude Code team tasks (`~/.claude/tasks/`) to GitHub Issues + Projects V2 kanban boards. It creates real GitHub Issues (not drafts), manages custom project fields, maps `blockedBy` to sub-issues, and auto-commits agent work with task context.

## Build & Development Commands

```bash
npm run build          # TypeScript compile (tsc) → dist/
npm run dev            # Watch mode build
npm test               # Run all tests (vitest run)
npm run test:watch     # Watch mode tests
npx vitest run tests/sync-engine.test.ts   # Run a single test file
npm link               # Install ccteams globally for CLI usage
```

**Prerequisites:** GitHub CLI (`gh`) installed + authenticated, `gh auth refresh -s project` for project scope, Node.js 20+.

## Architecture

### Entry Flow

`bin/ccteams.js` → `src/index.ts` (Commander.js CLI) → `src/commands/*.ts` → `src/core/*.ts`

The default command (`ccteams` with no args) runs `auto.ts`, which auto-detects the repo from git remote, creates a GitHub Project per team if needed, and syncs.

### Core Modules (`src/core/`)

- **sync-engine.ts** — Main sync algorithm. Acquires file lock, reads tasks, computes SHA-256 change hashes, creates/updates/archives GitHub Issues, sets custom fields, handles auto-commit + push. This is the central orchestrator.
- **github-project.ts** — GitHub GraphQL API client. All mutations (create project, create issue, update fields, manage labels, link sub-issues) go through here. Uses `gh` CLI for API calls, not an SDK.
- **claude-reader.ts** — Reads task JSON files from `~/.claude/tasks/{teamName}/` and team config from `~/.claude/teams/{teamName}/config.json`. Filters out member-assignment tasks and role-description tasks.
- **sync-state.ts** — Manages `.ccteams-sync.{teamName}.json` persistence (per-team isolation). Tracks project metadata, field IDs, item mappings, and last-sync hashes.
- **field-mapper.ts** — Maps task properties to GitHub Project custom field values.

### Commands (`src/commands/`)

`auto` (default) | `init` | `sync` | `watch` | `hooks install/uninstall` | `status` | `close` | `reset`

### Utilities (`src/utils/`)

- **gh-auth.ts** — Wraps `gh` CLI for GraphQL (`runGraphQL`) and REST (`runREST`) calls via child process spawning.
- **lock.ts** — File-based locking (`.ccteams-sync.{teamName}.lock`) with stale detection (2min) and polling backoff. Prevents concurrent syncs per team.
- **retry.ts** — Exponential backoff (1s base, 3 max retries).
- **concurrency.ts** — Bounded-concurrency `pMap` for parallel API calls.
- **git.ts** — Git remote URL parsing. **paths.ts** — Path helpers. **logger.ts** — Colored console output.

### Key Patterns

- **Change detection:** SHA-256 hash of task fields; only updates GitHub when hash differs from stored `lastHash`.
- **Dependency ordering:** Tasks sorted by `blockedBy` so parents are created before children. First `blockedBy` target becomes the GitHub parent issue.
- **Status mapping:** `pending` → Todo, `in_progress` → In Progress, `completed` → Done.
- **Labels:** `ccteams:{teamName}` (purple #6f42c1), one per team.
- **Task filtering:** Skips tasks whose subject matches team member names, other task owners, or role-assignment prompts (English/Korean patterns).
- **Per-agent git info:** Reads branch + HEAD SHA from each agent's `cwd` (supports worktrees), links commits to issues.
- **Auto-commit format:** `[ccteams] {agent}@{team}: {task-subject}` with task status summary in body.

### Sync State Files

- `.ccteams-sync.{teamName}.json` — Per-team sync state in project root (gitignored).
- `.ccteams-sync.{teamName}.lock` — Temporary lock file during sync.

## Team Naming Convention

When creating a team with `TeamCreate`, the `team_name` MUST be a short, descriptive **noun** derived from the user's task request. Do NOT use random or codename-style names.

Rules:
- Use a noun or noun phrase that summarizes the task (e.g., `snake-game`, `auth-api`, `dashboard`, `chat-app`)
- Keep it to 1-3 words, kebab-case
- The name should make it immediately clear what the team is building
- Examples:
  - User asks "Make a snake game" → team_name: `snake-game`
  - User asks "Build a REST API for user authentication" → team_name: `auth-api`
  - User asks "Create a weather dashboard" → team_name: `weather-dashboard`

The GitHub Project title is auto-generated from the team name (`ccteams: {teamName}`), so a good team name also produces a good project title.

## Testing

Tests are in `tests/` using Vitest with globals enabled. Key test files: `sync-engine.test.ts`, `sync-state.test.ts`, `claude-reader.test.ts`.

## TypeScript

ES module project (`"type": "module"` in package.json). Target ES2022, module Node16, strict mode. All source in `src/`, compiled output in `dist/`.
