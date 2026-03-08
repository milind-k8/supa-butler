import { randomUUID } from 'node:crypto';

import { loadPlan, savePlan, updatePlan } from './task-store';
import type { Plan, Task, TaskStatus } from './types';

const DEFAULT_AGENT = 'generalist-agent';
const FALLBACK_AGENT = 'fallback-agent';

export interface PlannerTaskInput {
  title: string;
  dependencies?: string[];
  assigneeAgent?: string;
}

export interface TaskFailureResult {
  retried: boolean;
  escalated: boolean;
  reason: string;
  task: Task;
}

export class Planner {
  public createPlan(objective: string, taskInputs?: PlannerTaskInput[]): Plan {
    const now = new Date().toISOString();
    const planId = randomUUID();
    const tasks = (taskInputs ?? this.generateTasksFromObjective(objective)).map((task, index) =>
      this.toTask(task, index + 1),
    );

    return {
      id: planId,
      objective,
      tasks,
      createdAt: now,
    };
  }

  public async createAndPersistPlan(objective: string, taskInputs?: PlannerTaskInput[]): Promise<Plan> {
    const plan = this.createPlan(objective, taskInputs);
    await savePlan(plan);
    return plan;
  }

  public getSchedulableTasks(plan: Plan): Task[] {
    return plan.tasks.filter((task) => task.status === 'pending' && this.areDependenciesComplete(plan, task));
  }

  public markTaskStatus(plan: Plan, taskId: string, status: TaskStatus, output: string | null = null): Plan {
    const task = plan.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in plan ${plan.id}.`);
    }

    task.status = status;
    task.output = output;
    return plan;
  }

  public async scheduleNext(planId: string): Promise<Task[]> {
    const plan = await loadPlan(planId);
    const schedulable = this.getSchedulableTasks(plan);
    return schedulable;
  }

  public async completeTask(planId: string, taskId: string, output: string): Promise<Plan> {
    const plan = await loadPlan(planId);
    this.markTaskStatus(plan, taskId, 'complete', output);
    await updatePlan(plan);
    return plan;
  }

  public async handleTaskFailure(
    planId: string,
    taskId: string,
    error: Error,
    maxRetries = 1,
  ): Promise<TaskFailureResult> {
    const plan = await loadPlan(planId);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in plan ${plan.id}.`);
    }

    const attempt = this.extractRetryAttempt(task.output);
    const nextAttempt = attempt + 1;

    if (nextAttempt <= maxRetries) {
      task.status = 'pending';
      task.output = this.buildRetryOutput(nextAttempt, error.message);
      await updatePlan(plan);

      return {
        retried: true,
        escalated: false,
        reason: `Retrying task ${task.id}; attempt ${nextAttempt} of ${maxRetries}.`,
        task,
      };
    }

    task.status = 'blocked';
    task.assigneeAgent = this.chooseFallbackAgent(task.assigneeAgent);
    task.output = `Escalated after ${nextAttempt - 1} retries: ${error.message}`;
    await updatePlan(plan);

    return {
      retried: false,
      escalated: true,
      reason: `Task ${task.id} escalated to ${task.assigneeAgent}.`,
      task,
    };
  }

  private generateTasksFromObjective(objective: string): PlannerTaskInput[] {
    const normalized = objective.trim();

    return [
      { title: `Clarify success criteria for: ${normalized}` },
      { title: `Gather required context for: ${normalized}` },
      {
        title: `Implement solution for: ${normalized}`,
        dependencies: ['task-1', 'task-2'],
      },
      {
        title: `Validate and summarize outcomes for: ${normalized}`,
        dependencies: ['task-3'],
      },
    ];
  }

  private areDependenciesComplete(plan: Plan, task: Task): boolean {
    return task.dependencies.every((dependencyId) => {
      const dependency = plan.tasks.find((candidate) => candidate.id === dependencyId);
      return dependency?.status === 'complete';
    });
  }

  private toTask(input: PlannerTaskInput, ordinal: number): Task {
    return {
      id: `task-${ordinal}`,
      title: input.title,
      status: 'pending',
      dependencies: input.dependencies ?? [],
      assigneeAgent: input.assigneeAgent ?? DEFAULT_AGENT,
      output: null,
    };
  }

  private chooseFallbackAgent(currentAssignee: string): string {
    return currentAssignee === FALLBACK_AGENT ? `${FALLBACK_AGENT}-2` : FALLBACK_AGENT;
  }

  private extractRetryAttempt(output: string | null): number {
    if (!output) {
      return 0;
    }

    const match = output.match(/Retry attempt (\d+)/);
    if (!match) {
      return 0;
    }

    return Number.parseInt(match[1], 10) || 0;
  }

  private buildRetryOutput(attempt: number, message: string): string {
    return `Retry attempt ${attempt}: ${message}`;
  }
}
