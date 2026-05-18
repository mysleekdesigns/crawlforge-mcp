/**
 * installer.js — Skills installer for CrawlForge.
 * Installs skill markdown files into Claude Code, Cursor, or VS Code.
 *
 * Targets:
 *   claude-code  — ~/.claude/skills/crawlforge-*.md (one file per skill)
 *   cursor       — .cursor/rules/crawlforge.mdc (concatenated)
 *   vscode       — .github/instructions/crawlforge.instructions.md (concatenated)
 *
 * Idempotent: skips if already installed (use --force to overwrite).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skill files shipped with the package
const SKILL_FILES = [
  'crawlforge-mcp.md',
  'crawlforge-cli.md',
  'crawlforge-stealth.md',
  'crawlforge-research.md'
];

const SKILL_DIR = __dirname; // src/skills/

function readSkillFile(name) {
  const p = join(SKILL_DIR, name);
  if (!existsSync(p)) throw new Error(`Skill file not found: ${p}`);
  return readFileSync(p, 'utf8');
}

function concatenateSkills() {
  return SKILL_FILES.map(f => readSkillFile(f)).join('\n\n---\n\n');
}

/**
 * Install skills into the given target.
 * @param {{ target: 'claude-code'|'cursor'|'vscode'|'all', force?: boolean, dryRun?: boolean, cwd?: string }} opts
 * @returns {{ installed: string[], skipped: string[], paths: string[] }}
 */
export async function install({ target = 'all', force = false, dryRun = false, cwd = process.cwd() } = {}) {
  const targets = target === 'all' ? ['claude-code', 'cursor', 'vscode'] : [target];
  const results = { installed: [], skipped: [], paths: [] };

  for (const t of targets) {
    if (t === 'claude-code') {
      const skillsDir = join(homedir(), '.claude', 'skills');
      for (const fname of SKILL_FILES) {
        const dest = join(skillsDir, fname);
        results.paths.push(dest);
        if (!dryRun) {
          if (existsSync(dest) && !force) {
            results.skipped.push(dest);
            continue;
          }
          mkdirSync(skillsDir, { recursive: true });
          writeFileSync(dest, readSkillFile(fname), 'utf8');
        }
        results.installed.push(dest);
      }
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
 * @param {{ target: 'claude-code'|'cursor'|'vscode'|'all', cwd?: string }} opts
 * @returns {{ removed: string[], notFound: string[] }}
 */
export async function uninstall({ target = 'all', cwd = process.cwd() } = {}) {
  const targets = target === 'all' ? ['claude-code', 'cursor', 'vscode'] : [target];
  const results = { removed: [], notFound: [] };

  for (const t of targets) {
    if (t === 'claude-code') {
      const skillsDir = join(homedir(), '.claude', 'skills');
      for (const fname of SKILL_FILES) {
        const dest = join(skillsDir, fname);
        if (existsSync(dest)) {
          unlinkSync(dest);
          results.removed.push(dest);
        } else {
          results.notFound.push(dest);
        }
      }
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
