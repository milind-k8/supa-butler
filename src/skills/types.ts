export interface SkillInputDefinition {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillDefinition {
  name: string;
  description: string;
  inputs: SkillInputDefinition[];
  entrypoint: string;
  tags: string[];
  version: string;
}

export interface RegisteredSkill {
  definition: SkillDefinition;
  readmePath?: string;
  readme?: string;
  skillDir: string;
}
