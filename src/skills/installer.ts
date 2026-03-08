import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const BUILTIN_SKILLS_DIR = "skills";
export const CUSTOM_SKILLS_DIR = ".supa-butler/skills";

export const ALLOWED_RUNTIME_ACTIONS = ["exec", "read_file", "write_file"] as const;

type RuntimeAction = (typeof ALLOWED_RUNTIME_ACTIONS)[number];

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  entrypoint: string;
  runtimeActions?: RuntimeAction[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface SkillDescriptor {
  rootDir: string;
  manifestPath: string;
  manifest: SkillManifest;
  source: "builtin" | "custom";
}

export class SkillContractError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "SkillContractError";
  }
}

const REQUIRED_MANIFEST_FIELDS: Array<keyof SkillManifest> = [
  "name",
  "description",
  "version",
  "entrypoint",
];

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 128 * 1024;

export async function skillsAdd(pathOrGit: string, cwd = process.cwd()): Promise<string> {
  const destination = path.resolve(cwd, CUSTOM_SKILLS_DIR);
  await fs.mkdir(destination, { recursive: true });

  const isGit = /^https?:\/\//.test(pathOrGit) || /^git@/.test(pathOrGit) || pathOrGit.endsWith(".git");
  if (isGit) {
    const repoName = path.basename(pathOrGit.replace(/\.git$/, ""));
    const target = path.join(destination, repoName);
    await runCommand("git", ["clone", pathOrGit, target], cwd);
    return `Added skill from git: ${target}`;
  }

  const resolvedSource = path.resolve(cwd, pathOrGit);
  const target = path.join(destination, path.basename(resolvedSource));
  await copyDirectory(resolvedSource, target);
  return `Added skill from path: ${target}`;
}

export async function skillsRemove(name: string, cwd = process.cwd()): Promise<string> {
  const custom = path.resolve(cwd, CUSTOM_SKILLS_DIR, name);
  await fs.rm(custom, { recursive: true, force: true });
  return `Removed skill: ${name}`;
}

export async function skillsValidate(name: string, cwd = process.cwd()): Promise<{ valid: true }> {
  const allSkills = await loadAllSkills(cwd);
  const skill = allSkills.find((s) => s.manifest.name === name);
  if (!skill) {
    throw new SkillContractError(`Skill '${name}' was not found`, { name });
  }
  validateManifestOrThrow(skill.manifest, skill.rootDir);
  return { valid: true };
}

export async function loadAllSkills(cwd = process.cwd()): Promise<SkillDescriptor[]> {
  const [builtIn, custom] = await Promise.all([
    loadSkillsFromDirectory(path.resolve(cwd, BUILTIN_SKILLS_DIR), "builtin"),
    loadSkillsFromDirectory(path.resolve(cwd, CUSTOM_SKILLS_DIR), "custom"),
  ]);

  const byName = new Map<string, SkillDescriptor>();
  for (const skill of [...builtIn, ...custom]) {
    byName.set(skill.manifest.name, skill);
  }

  return [...byName.values()];
}

export async function executeSkill(
  skill: SkillDescriptor,
  input: unknown,
  cwd = process.cwd(),
): Promise<string> {
  validateManifestOrThrow(skill.manifest, skill.rootDir);

  const deniedActions = (skill.manifest.runtimeActions ?? []).filter(
    (action) => !ALLOWED_RUNTIME_ACTIONS.includes(action),
  );
  if (deniedActions.length > 0) {
    throw new SkillContractError("Skill requested disallowed runtime action", {
      skill: skill.manifest.name,
      deniedActions,
      allowed: ALLOWED_RUNTIME_ACTIONS,
    });
  }

  const timeoutMs = skill.manifest.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = skill.manifest.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const entrypoint = path.resolve(skill.rootDir, skill.manifest.entrypoint);

  return executeWithGuards(entrypoint, JSON.stringify(input ?? {}), { timeoutMs, maxOutputBytes, cwd });
}

async function loadSkillsFromDirectory(
  directory: string,
  source: "builtin" | "custom",
): Promise<SkillDescriptor[]> {
  if (!(await exists(directory))) {
    return [];
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  const skills: SkillDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rootDir = path.join(directory, entry.name);
    const manifestPath = path.join(rootDir, "manifest.json");
    if (!(await exists(manifestPath))) {
      continue;
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SkillManifest;
    skills.push({ rootDir, manifestPath, manifest, source });
  }

  return skills;
}

function validateManifestOrThrow(manifest: SkillManifest, skillRoot: string): void {
  const missing = REQUIRED_MANIFEST_FIELDS.filter((field) => !manifest[field]);
  if (missing.length > 0) {
    throw new SkillContractError("Skill manifest is missing required fields", {
      missing,
      required: REQUIRED_MANIFEST_FIELDS,
      manifest,
    });
  }

  const entrypoint = path.resolve(skillRoot, manifest.entrypoint);
  if (!path.normalize(entrypoint).startsWith(path.normalize(skillRoot))) {
    throw new SkillContractError("Skill entrypoint must remain inside skill directory", {
      entrypoint,
      skillRoot,
    });
  }

  if (!manifest.inputSchema) {
    return;
  }

  const { inputSchema } = manifest;
  if (inputSchema.type && inputSchema.type !== "object") {
    throw new SkillContractError("inputSchema.type must be 'object' when provided", {
      type: inputSchema.type,
    });
  }

  if (inputSchema.required && !Array.isArray(inputSchema.required)) {
    throw new SkillContractError("inputSchema.required must be an array of property names", {
      required: inputSchema.required,
    });
  }

  if (inputSchema.required && inputSchema.properties) {
    const undefinedRequired = inputSchema.required.filter((key) => !(key in inputSchema.properties!));
    if (undefinedRequired.length > 0) {
      throw new SkillContractError("inputSchema.required includes unknown properties", {
        undefinedRequired,
      });
    }
  }
}

async function executeWithGuards(
  entrypoint: string,
  inputPayload: string,
  options: { timeoutMs: number; maxOutputBytes: number; cwd: string },
): Promise<string> {
  if (!(await exists(entrypoint))) {
    throw new SkillContractError("Skill entrypoint does not exist", { entrypoint });
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn("node", [entrypoint], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new SkillContractError("Skill execution timed out", {
          timeoutMs: options.timeoutMs,
          entrypoint,
        }),
      );
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > options.maxOutputBytes) {
        child.kill("SIGKILL");
        clearTimeout(timeout);
        reject(
          new SkillContractError("Skill output exceeded maxOutputBytes", {
            maxOutputBytes: options.maxOutputBytes,
          }),
        );
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new SkillContractError("Failed to start skill entrypoint", {
          entrypoint,
          error: error.message,
        }),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new SkillContractError("Skill contract violated: non-zero exit", {
            entrypoint,
            code,
            stderr,
          }),
        );
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(inputPayload);
    child.stdin.end();
  });
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new SkillContractError("Command failed", { command, args, code }));
    });
    child.on("error", reject);
  });
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) {
    throw new SkillContractError("Source skill path does not exist", { source });
  }
  await fs.cp(source, destination, { recursive: true, force: true });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function handleSkillsCommand(args: string[], cwd = process.cwd()): Promise<string> {
  const [command, value] = args;
  if (!command || !value) {
    throw new SkillContractError(
      "Usage: skills add <path-or-git> | skills validate <name> | skills remove <name>",
    );
  }

  switch (command) {
    case "add":
      return skillsAdd(value, cwd);
    case "validate":
      await skillsValidate(value, cwd);
      return `Skill '${value}' is valid`;
    case "remove":
      return skillsRemove(value, cwd);
    default:
      throw new SkillContractError(`Unknown skills command '${command}'`, {
        command,
      });
  }
}
