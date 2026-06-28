#!/usr/bin/env node
/**
 * Regenerate the canonical root SKILL.md from the Agent Skills in
 * src/skills/agent-skills/. Maintainer build step — not used at runtime.
 *
 * Usage: npm run skills:gen
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatenateSkills } from '../src/skills/installer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const banner =
  '# CrawlForge Skill Reference\n\n' +
  '> Auto-generated from `src/skills/agent-skills/*/SKILL.md`. ' +
  'To regenerate, run `npm run skills:gen` (calls `concatenateSkills()` from `src/skills/installer.js`).\n>\n' +
  '> This file is the canonical capabilities reference for AI agents using CrawlForge MCP tools.\n\n' +
  '---\n\n';

const out = join(ROOT, 'SKILL.md');
writeFileSync(out, banner + concatenateSkills() + '\n', 'utf8');
process.stderr.write('Wrote ' + out + '\n');
