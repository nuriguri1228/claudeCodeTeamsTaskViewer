// Status mapping: Claude status -> GitHub status label
export const STATUS_MAP: Record<string, string> = {
  pending: 'Todo',
  in_progress: 'In Progress',
  completed: 'Done',
};

// Custom fields to create on GitHub Project
export const CUSTOM_FIELDS = [
  { name: 'Team Name', dataType: 'TEXT' as const },
  { name: 'Agent (Owner)', dataType: 'SINGLE_SELECT' as const },
  { name: 'Task ID', dataType: 'TEXT' as const },
  { name: 'Blocked By', dataType: 'TEXT' as const },
  { name: 'Active Form', dataType: 'TEXT' as const },
];

// Default sync file name
export const SYNC_FILE = '.ccteams-sync.json';

// Default debounce interval for watch mode (ms)
export const DEFAULT_DEBOUNCE_MS = 1000;

// Max retry attempts for API calls
export const MAX_RETRIES = 3;

// Base delay for exponential backoff (ms)
export const BASE_RETRY_DELAY_MS = 1000;
