import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Plan } from './types';

const PLANS_DIR = join('.supa-butler', 'plans');

function getPlanJsonPath(planId: string): string {
  return join(PLANS_DIR, `${planId}.json`);
}

function getPlanMarkdownPath(planId: string): string {
  return join(PLANS_DIR, `${planId}.md`);
}

function formatPlanMarkdown(plan: Plan): string {
  const lines: string[] = [
    `# Plan ${plan.id}`,
    '',
    `**Objective:** ${plan.objective}`,
    `**Created At:** ${plan.createdAt}`,
    '',
    '## Tasks',
    '',
  ];

  for (const task of plan.tasks) {
    const dependencies = task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None';
    lines.push(`### ${task.id}: ${task.title}`);
    lines.push(`- Status: ${task.status}`);
    lines.push(`- Dependencies: ${dependencies}`);
    lines.push(`- Assignee: ${task.assigneeAgent}`);
    lines.push(`- Output: ${task.output ?? 'N/A'}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function savePlan(plan: Plan): Promise<void> {
  await mkdir(PLANS_DIR, { recursive: true });

  await Promise.all([
    writeFile(getPlanJsonPath(plan.id), JSON.stringify(plan), 'utf8'),
    writeFile(getPlanMarkdownPath(plan.id), formatPlanMarkdown(plan), 'utf8'),
  ]);
}

export async function loadPlan(planId: string): Promise<Plan> {
  const content = await readFile(getPlanJsonPath(planId), 'utf8');
  return JSON.parse(content) as Plan;
}

export async function updatePlan(plan: Plan): Promise<void> {
  await savePlan(plan);
}
