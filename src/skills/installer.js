/**
 * installer.js — Skills installer for CrawlForge.
 *
 * Installs CrawlForge's Claude Agent Skills into Claude Code, Cursor, or VS Code.
 *
 * Targets:
 *   claude-code  — ~/.claude/skills/<skill-name>/SKILL.md  (real Agent Skill
 *                  folders with YAML frontmatter, so they auto-activate)
 *   cursor       — .cursor/rules/crawlforge.mdc            (concatenated bodies)
 *   vscode       — .github/instructions/crawlforge.instructions.md (concatenated)
 *
 * Source of truth: src/skills/agent-skills/<skill-name>/SKILL.md (+ references/).
 *
 * Idempotent: skips if already installed (use --force to overwrite). Installing /
 * uninstalling also removes any leftover bare crawlforge-*.md files written by
 * pre-4.8.0 versions (migration), without touching unrelated user skills.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  readdirSync,
  statSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// New source of truth: one folder per skill, each containing a SKILL.md.
const AGENT_SKILLS_DIR = join(__dirname, 'agent-skills');

// Pre-4.8.0 bare files that may linger in ~/.claude/skills (migration cleanup).
const LEGACY_SKILL_FILES = [
  'crawlforge-mcp.md',
  'crawlforge-cli.md',
  'crawlforge-stealth.md',
  'crawlforge-research.md',
];

/**
 * Discover the shipped Agent Skills.
 * @returns {{ name: string, srcDir: string, skillMd: string }[]}
 */
export function listAgentSkills() {
  if (!existsSync(AGENT_SKILLS_DIR)) {
    throw new Error(`Agent skills directory not found: ${AGENT_SKILLS_DIR}`);
  }
  return readdirSync(AGENT_SKILLS_DIR)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .map((name) => ({ name, srcDir: join(AGENT_SKILLS_DIR, name) }))
    .filter((s) => {
      try {
        return statSync(s.srcDir).isDirectory() && existsSync(join(s.srcDir, 'SKILL.md'));
      } catch {
        return false;
      }
    })
    .map((s) => ({ ...s, skillMd: join(s.srcDir, 'SKILL.md') }));
}

/**
 * Read a skill's SKILL.md and strip the leading YAML frontmatter block, leaving
 * just the markdown body (used for the concatenated cursor/vscode outputs).
 * @param {string} skillMdPath
 * @returns {string}
 */
export function readSkillBody(skillMdPath) {
  const raw = readFileSync(skillMdPath, 'utf8');
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

/**
 * Concatenate all skill bodies into a single document (root SKILL.md + the
 * cursor/vscode single-file targets). Kept named for backwards compatibility.
 * @returns {string}
 */
export function concatenateSkills() {
  return listAgentSkills()
    .map((s) => readSkillBody(s.skillMd))
    .join('\n\n---\n\n');
}

function copySkillFolder(srcDir, destDir) {
  cpSync(srcDir, destDir, { recursive: true, force: true });
}

/**
 * Remove leftover pre-4.8.0 bare crawlforge-*.md files from a skills dir.
 * Strictly scoped to the four known filenames — never globs, never touches
 * unrelated skills or folders.
 * @param {string} skillsDir
 * @returns {string[]} removed paths
 */
export function cleanupLegacyClaudeSkills(skillsDir) {
  const removed = [];
  for (const fname of LEGACY_SKILL_FILES) {
    const p = join(skillsDir, fname);
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        unlinkSync(p);
        removed.push(p);
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/**
 * Install skills into the given target.
 * @param {{ target?: 'claude-code'|'cursor'|'vscode'|'all', force?: boolean, dryRun?: boolean, cwd?: string, homeDir?: string }} opts
 * @returns {{ installed: string[], skipped: string[], paths: string[] }}
 */
export async function install({
  target = 'all',
  force = false,
  dryRun = false,
  cwd = process.cwd(),
  homeDir = homedir(),
} = {}) {
  const targets = target === 'all' ? ['claude-code', 'cursor', 'vscode'] : [target];
  const results = { installed: [], skipped: [], paths: [] };
  const skills = listAgentSkills();

  for (const t of targets) {
    if (t === 'claude-code') {
      const skillsDir = join(homeDir, '.claude', 'skills');
      for (const skill of skills) {
        const destDir = join(skillsDir, skill.name);
        const destSkillMd = join(destDir, 'SKILL.md');
        results.paths.push(destSkillMd);
        if (!dryRun) {
          if (existsSync(destSkillMd) && !force) {
            results.skipped.push(destSkillMd);
            continue;
          }
          mkdirSync(skillsDir, { recursive: true });
          copySkillFolder(skill.srcDir, destDir);
        }
        results.installed.push(destSkillMd);
      }
      // Migration: remove stale bare files from older versions.
      if (!dryRun) cleanupLegacyClaudeSkills(skillsDir);
    } else if (t === 'cursor') {
      const dir = join(cwd, '.cursor', 'rules');
      const dest = join(dir, 'crawlforge.mdc');
      results.paths.push(dest);
      if (!dryRun) {
        if (existsSync(dest) && !force) {
          results.skipped.push(dest);
          continue;
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(dest, concatenateSkills(), 'utf8');
      }
      results.installed.push(dest);
    } else if (t === 'vscode') {
      const dir = join(cwd, '.github', 'instructions');
      const dest = join(dir, 'crawlforge.instructions.md');
      results.paths.push(dest);
      if (!dryRun) {
        if (existsSync(dest) && !force) {
          results.skipped.push(dest);
          continue;
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(dest, concatenateSkills(), 'utf8');
      }
      results.installed.push(dest);
    } else {
      throw new Error(`Unknown target: ${t}. Valid targets: claude-code, cursor, vscode, all`);
    }
  }

  return results;
}

/**
 * Uninstall skills from the given target.
 * @param {{ target?: 'claude-code'|'cursor'|'vscode'|'all', cwd?: string, homeDir?: string }} opts
 * @returns {{ removed: string[], notFound: string[] }}
 */
export async function uninstall({ target = 'all', cwd = process.cwd(), homeDir = homedir() } = {}) {
  const targets = target === 'all' ? ['claude-code', 'cursor', 'vscode'] : [target];
  const results = { removed: [], notFound: [] };
  const skills = listAgentSkills();

  for (const t of targets) {
    if (t === 'claude-code') {
      const skillsDir = join(homeDir, '.claude', 'skills');
      for (const skill of skills) {
        const destDir = join(skillsDir, skill.name);
        if (existsSync(destDir)) {
          rmSync(destDir, { recursive: true, force: true });
          results.removed.push(destDir);
        } else {
          results.notFound.push(destDir);
        }
      }
      results.removed.push(...cleanupLegacyClaudeSkills(skillsDir));
    } else if (t === 'cursor') {
      const dest = join(cwd, '.cursor', 'rules', 'crawlforge.mdc');
      if (existsSync(dest)) {
        unlinkSync(dest);
        results.removed.push(dest);
      } else {
        results.notFound.push(dest);
      }
    } else if (t === 'vscode') {
      const dest = join(cwd, '.github', 'instructions', 'crawlforge.instructions.md');
      if (existsSync(dest)) {
        unlinkSync(dest);
        results.removed.push(dest);
      } else {
        results.notFound.push(dest);
      }
    }
  }

  return results;
}

// --- Optional, opt-in forced-eval hook (boosts skill auto-activation) ---

const HOOK_MARKER = 'CrawlForge skill';
const HOOK_COMMAND =
  "echo 'Consider whether a CrawlForge skill applies: web scraping, deep research, " +
  "stealth browsing, structured extraction, change tracking, or batch automation.'";

/**
 * Add a UserPromptSubmit forced-eval reminder to ~/.claude/settings.json.
 * Idempotent additive merge — preserves all existing settings and only adds the
 * hook if an equivalent one is not already present. Opt-in (CLI --with-hook).
 * @param {{ homeDir?: string }} opts
 * @returns {{ added: boolean, path: string }}
 */
export function installHook({ homeDir = homedir() } = {}) {
  const dir = join(homeDir, '.claude');
  const path = join(dir, 'settings.json');
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      settings = {};
    }
  }
  settings.hooks = settings.hooks || {};
  const list = Array.isArray(settings.hooks.UserPromptSubmit)
    ? settings.hooks.UserPromptSubmit
    : [];
  const already = JSON.stringify(list).includes(HOOK_MARKER);
  if (already) return { added: false, path };

  list.push({ hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  settings.hooks.UserPromptSubmit = list;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { added: true, path };
}

/**
 * Remove the CrawlForge forced-eval hook from ~/.claude/settings.json.
 * @param {{ homeDir?: string }} opts
 * @returns {{ removed: boolean, path: string }}
 */
export function uninstallHook({ homeDir = homedir() } = {}) {
  const path = join(homeDir, '.claude', 'settings.json');
  if (!existsSync(path)) return { removed: false, path };
  let settings;
  try {
    settings = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { removed: false, path };
  }
  const list = settings?.hooks?.UserPromptSubmit;
  if (!Array.isArray(list)) return { removed: false, path };
  const filtered = list.filter((entry) => !JSON.stringify(entry).includes(HOOK_MARKER));
  if (filtered.length === list.length) return { removed: false, path };
  settings.hooks.UserPromptSubmit = filtered;
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { removed: true, path };
}
