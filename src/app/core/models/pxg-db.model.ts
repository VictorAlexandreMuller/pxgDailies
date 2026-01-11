export type Period = 'daily' | 'weekly' | 'monthly';

export interface PxgDbV1 {
  schemaVersion: 1;
  syncCodeHash?: string;
  profile: {
    displayName: string;
    createdAt: string;
    lastOpenAt: string;
  };
  meta: {
    updatedAt: string;
    revision: number;
  };
  characters: Character[];
}

export interface Character {
  id: string;
  name: string;
  createdAt: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  title: string;
  period: Period;
  origin?: 'system' | 'user';
  archivedAt?: string;
  doneForKey?: string;
  doingForKey?: string;
  doneAt?: string;
  resetAt?: string;
}

