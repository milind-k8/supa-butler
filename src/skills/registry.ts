import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SkillDefinition, RegisteredSkill } from './types';

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();

  constructor(private readonly rootDir: string = process.cwd()) {}

  async load(): Promise<void> {
    this.skills.clear();
    const skillsRoot = path.join(this.rootDir, 'skills');
    const jsonPaths = await this.findSkillJsonFiles(skillsRoot);

    for (const jsonPath of jsonPaths) {
      const definition = await this.readDefinition(jsonPath);
      const skillDir = path.dirname(jsonPath);
      const readmePath = path.join(skillDir, 'README.md');
      const readme = await this.readReadme(readmePath);

      this.skills.set(definition.name.toLowerCase(), {
        definition,
        readme,
        readmePath: readme ? readmePath : undefined,
        skillDir,
      });
    }
  }

  list(tag?: string): RegisteredSkill[] {
    const normalizedTag = tag?.trim().toLowerCase();
    const allSkills = Array.from(this.skills.values());

    const filtered = normalizedTag
      ? allSkills.filter((skill) =>
          skill.definition.tags.some((skillTag) => skillTag.toLowerCase() === normalizedTag),
        )
      : allSkills;

    return filtered.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
  }

  search(query: string): RegisteredSkill[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.list();
    }

    return Array.from(this.skills.values())
      .map((skill) => ({
        skill,
        score: this.scoreSkill(skill.definition, normalized),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.skill.definition.name.localeCompare(b.skill.definition.name))
      .map(({ skill }) => skill);
  }

  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name.toLowerCase());
  }

  private scoreSkill(skill: SkillDefinition, query: string): number {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    const tags = skill.tags.map((tag) => tag.toLowerCase());

    let score = 0;

    if (name === query) score += 100;
    else if (name.startsWith(query)) score += 60;
    else if (name.includes(query)) score += 45;

    if (description.includes(query)) score += 20;

    for (const tag of tags) {
      if (tag === query) score += 30;
      else if (tag.includes(query)) score += 15;
    }

    return score;
  }

  private async findSkillJsonFiles(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const found: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = await this.findSkillJsonFiles(fullPath);
          found.push(...nested);
        } else if (entry.isFile() && entry.name === 'skill.json') {
          found.push(fullPath);
        }
      }

      return found;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async readDefinition(jsonPath: string): Promise<SkillDefinition> {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SkillDefinition>;

    if (!parsed.name || !parsed.description || !parsed.entrypoint || !parsed.version) {
      throw new Error(`Invalid skill definition at ${jsonPath}`);
    }

    return {
      name: parsed.name,
      description: parsed.description,
      inputs: Array.isArray(parsed.inputs) ? parsed.inputs : [],
      entrypoint: parsed.entrypoint,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      version: parsed.version,
    };
  }

  private async readReadme(readmePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(readmePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}
