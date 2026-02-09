export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
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
