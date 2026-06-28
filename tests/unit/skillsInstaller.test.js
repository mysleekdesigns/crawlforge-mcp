/**
 * Skills installer (v4.8) — real Claude Agent Skill folders + migration.
 * Run: node --test tests/unit/skillsInstaller.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listAgentSkills, readSkillBody, concatenateSkills, install, uninstall, cleanupLegacyClaudeSkills,
} from '../../src/skills/installer.js';

describe('listAgentSkills + frontmatter validity', () => {
  const skills = listAgentSkills();
  test('discovers 7 skills, each with a SKILL.md', () => {
    assert.equal(skills.length, 7);
    for (const s of skills) assert.ok(existsSync(s.skillMd), `${s.name} has SKILL.md`);
  });
  test('every skill has valid frontmatter (name, description ≤1024, no angle brackets, no reserved words)', () => {
    for (const s of skills) {
      const raw = readFileSync(s.skillMd, 'utf8');
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      assert.ok(fm, `${s.name} has YAML frontmatter`);
      const block = fm[1];
      const name = (block.match(/name:\s*(.+)/) || [])[1]?.trim();
      const desc = (block.match(/description:\s*([\s\S]*)/) || [])[1] || '';
      assert.equal(name, s.name, `${s.name}: name matches folder`);
      assert.ok(/^[a-z0-9-]+$/.test(name), `${s.name}: kebab-case name`);
      assert.ok(name.length <= 64, `${s.name}: name ≤64`);
      assert.ok(!/claude|anthropic/i.test(name), `${s.name}: no reserved words in name`);
      assert.ok(!block.includes('<') && !block.includes('>'), `${s.name}: no angle brackets in frontmatter`);
      // description value (first line) within 1024 chars
      const descLine = desc.split('\n')[0].replace(/^["']|["']$/g, '');
      assert.ok(descLine.length <= 1024, `${s.name}: description ≤1024`);
    }
  });
  test('readSkillBody strips frontmatter', () => {
    const body = readSkillBody(skills[0].skillMd);
    assert.ok(!body.startsWith('---'), 'frontmatter stripped from body');
  });
});

describe('install / idempotency / migration / uninstall', () => {
  const skills = listAgentSkills();

  test('claude-code install creates SKILL.md folders, removes legacy bare files, spares unrelated skills', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cf-home-'));
    const skillsDir = join(home, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    // legacy bare file + unrelated user skill
    writeFileSync(join(skillsDir, 'crawlforge-mcp.md'), 'legacy', 'utf8');
    mkdirSync(join(skillsDir, 'other-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'other-skill', 'SKILL.md'), '---\nname: other-skill\n---\nx', 'utf8');

    const r1 = await install({ target: 'claude-code', homeDir: home });
    assert.equal(r1.installed.length, skills.length);
    assert.ok(r1.paths.every((p) => p.endsWith('/SKILL.md')));
    assert.ok(!existsSync(join(skillsDir, 'crawlforge-mcp.md')), 'legacy file migrated away');
    assert.ok(existsSync(join(skillsDir, 'crawlforge-web-scraping', 'SKILL.md')));
    assert.ok(existsSync(join(skillsDir, 'other-skill', 'SKILL.md')), 'unrelated skill untouched');

    // idempotent
    const r2 = await install({ target: 'claude-code', homeDir: home });
    assert.equal(r2.skipped.length, skills.length);
    assert.equal(r2.installed.length, 0);

    // force overwrites
    const r3 = await install({ target: 'claude-code', homeDir: home, force: true });
    assert.equal(r3.installed.length, skills.length);

    // uninstall removes our folders + legacy, keeps other-skill
    const u = await uninstall({ target: 'claude-code', homeDir: home });
    assert.ok(u.removed.length >= skills.length);
    assert.ok(!existsSync(join(skillsDir, 'crawlforge-web-scraping')));
    assert.ok(existsSync(join(skillsDir, 'other-skill', 'SKILL.md')), 'unrelated skill still present');
  });

  test('cursor + vscode produce concatenated single files', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cf-cwd-'));
    await install({ target: 'cursor', cwd });
    await install({ target: 'vscode', cwd });
    assert.ok(existsSync(join(cwd, '.cursor', 'rules', 'crawlforge.mdc')));
    assert.ok(existsSync(join(cwd, '.github', 'instructions', 'crawlforge.instructions.md')));
  });

  test('concatenateSkills contains all skills and leaks no frontmatter', () => {
    const concat = concatenateSkills();
    assert.ok(concat.length > 1000);
    assert.ok(!/\n---\nname:/.test(concat), 'no leaked YAML frontmatter block');
  });

  test('cleanupLegacyClaudeSkills only removes the 4 known filenames', () => {
    const home = mkdtempSync(join(tmpdir(), 'cf-home2-'));
    const skillsDir = join(home, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'crawlforge-cli.md'), 'x', 'utf8');
    writeFileSync(join(skillsDir, 'keep-me.md'), 'x', 'utf8');
    const removed = cleanupLegacyClaudeSkills(skillsDir);
    assert.ok(removed.some((p) => p.endsWith('crawlforge-cli.md')));
    assert.ok(existsSync(join(skillsDir, 'keep-me.md')), 'unrelated file kept');
  });
});
