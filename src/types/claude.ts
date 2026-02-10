export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
  cwd?: string;  // agent's working directory (may be a worktree)
}

export interface TeamConfig {
  team_name: string;
  description?: string;
  members: TeamMember[];
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  activeForm?: string;
  blockedBy?: string[];
  blocks?: string[];
  metadata?: Record<string, unknown>;
}
