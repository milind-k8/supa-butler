#!/usr/bin/env node
import { Command } from 'commander';
import { registerSkillsCommands } from './skills';

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program.name('supa-butler').description('CLI for managing and running skills');

  registerSkillsCommands(program);

  await program.parseAsync(argv);
}

void run();
