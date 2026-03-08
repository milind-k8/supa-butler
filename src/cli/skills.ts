import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { SkillRegistry } from '../skills/registry';

interface RunOptions {
  input: string;
}

interface ListOptions {
  tag?: string;
}

export function registerSkillsCommands(program: Command, rootDir: string = process.cwd()): void {
  const registry = new SkillRegistry(rootDir);

  const skills = program.command('skills').description('Manage local skills');

  skills
    .command('list')
    .description('List available skills')
    .option('--tag <tag>', 'Filter skills by tag')
    .action(async (options: ListOptions) => {
      await registry.load();
      const results = registry.list(options.tag);
      if (!results.length) {
        console.log('No skills found.');
        return;
      }

      for (const skill of results) {
        console.log(`${skill.definition.name}@${skill.definition.version} - ${skill.definition.description}`);
      }
    });

  skills
    .command('search <query>')
    .description('Search skills by name, description, or tags')
    .action(async (query: string) => {
      await registry.load();
      const results = registry.search(query);
      if (!results.length) {
        console.log('No matching skills found.');
        return;
      }

      for (const skill of results) {
        console.log(`${skill.definition.name} (${skill.definition.tags.join(', ') || 'no-tags'})`);
      }
    });

  skills
    .command('show <name>')
    .description('Show skill details')
    .action(async (name: string) => {
      await registry.load();
      const skill = registry.get(name);
      if (!skill) {
        console.error(`Skill not found: ${name}`);
        process.exitCode = 1;
        return;
      }

      console.log(JSON.stringify(skill.definition, null, 2));
      if (skill.readme) {
        console.log('\n--- README ---\n');
        console.log(skill.readme);
      }
    });

  skills
    .command('run <name>')
    .description('Run a skill entrypoint with JSON input')
    .requiredOption('--input <json>', 'JSON payload passed to the skill entrypoint')
    .action(async (name: string, options: RunOptions) => {
      await registry.load();
      const skill = registry.get(name);
      if (!skill) {
        console.error(`Skill not found: ${name}`);
        process.exitCode = 1;
        return;
      }

      let input: unknown;
      try {
        input = JSON.parse(options.input);
      } catch {
        console.error('--input must be valid JSON');
        process.exitCode = 1;
        return;
      }

      const entrypoint = path.isAbsolute(skill.definition.entrypoint)
        ? skill.definition.entrypoint
        : path.join(skill.skillDir, skill.definition.entrypoint);

      const child = spawn(entrypoint, {
        stdio: ['pipe', 'inherit', 'inherit'],
        shell: true,
      });

      child.stdin.write(`${JSON.stringify(input)}\n`);
      child.stdin.end();

      await new Promise<void>((resolve) => {
        child.on('close', (code) => {
          if (code !== 0) {
            process.exitCode = code ?? 1;
          }
          resolve();
        });
      });
    });
}
