export interface ItemMapping {
  taskId: string;
  teamName: string;
  githubItemId: string;
  contentId: string;
  issueNodeId: string;
  issueNumber: number;
  lastHash: string;
  lastSyncedAt: string;
  lastOwner?: string;
}

export interface SyncStateData {
  project: {
    id: string;
    number: number;
    url: string;
    title: string;
    owner: string;
  };
  repository: {
    id: string;
    owner: string;
    name: string;
  };
  fields: Record<string, string>;  // field name -> field ID
  statusOptions: Record<string, string>;  // status name -> option ID
  ownerOptions: Record<string, string>;  // owner name -> option ID
  labels: Record<string, string>;  // label name -> label ID
  items: ItemMapping[];
  summaryIssues?: Record<string, { issueNodeId: string; issueNumber: number }>;
  lastSyncAt: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  archived: number;
  skipped: number;
  errors: Array<{ taskId: string; error: string }>;
}
