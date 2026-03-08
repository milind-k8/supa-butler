export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'complete';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  dependencies: string[];
  assigneeAgent: string;
  output: string | null;
}

export interface Plan {
  id: string;
  objective: string;
  tasks: Task[];
  createdAt: string;
}

export interface RetryContext {
  failedTaskId: string;
  lastError: string;
  attempt: number;
}
