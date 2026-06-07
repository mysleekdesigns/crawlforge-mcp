/**
 * init command — one-shot setup: API key check + skill install + MCP stanza merge.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { install } from '../../skills/installer.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '';

function loadStoredApiKey() {
  try {
    const cfg = JSON.parse(readFileSync(join(HOME, '.crawlforge', 'config.json'), 'utf8'));
    return cfg.apiKey || undefined;
  } catch {
    return undefined;
  }
}

function mcpStanza(apiKey) {
  const stanza = { command: 'npx', args: ['-y', 'crawlforge@latest', 'mcp'] };
  if (apiKey) stanza.env = { CRAWLFORGE_API_KEY: apiKey };
  return stanza;
}

function mergeClientConfig(configPath, apiKey) {
  let existing = {};
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf8')); } catch { /* keep {} */ }
  } else {
    const dir = configPath.substring(0, configPath.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
  }
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers.crawlforge = mcpStanza(apiKey);
  writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return configPath;
}

function resolveClientPaths(client) {
  const paths = [];
  if (!client || client === 'claude-code') {
    paths.push({ label: 'Claude Code', path: join(HOME, '.claude.json') });
  }
  if (!client || client === 'claude-desktop') {
    const desktopPath = process.platform === 'darwin'
      ? join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'win32'
        ? join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
    paths.push({ label: 'Claude Desktop', path: desktopPath });
  }
  if (!client || client === 'cursor') {
    paths.push({ label: 'Cursor', path: join(HOME, '.cursor', 'mcp.json') });
  }
  return paths;
}

export function register(program) {
  program
    .command('init')
    .description('Set up CrawlForge: verify API key, install skills, and register the MCP server with your AI clients')
    .option('--all', 'Install skills to all targets and register all detected client configs')
    .option('--client <name>', 'Target client to register: claude-code, claude-desktop, or cursor')
    .option('--yes', 'Non-interactive — assume yes to all prompts')
    .action(async (opts) => {
      const out = (msg) => process.stderr.write(msg + '\n');

      // 1. API key check
      const apiKey = loadStoredApiKey() || process.env.CRAWLFORGE_API_KEY;
      if (!apiKey) {
        out('No CrawlForge API key found.');
        out('Run: npx crawlforge-setup');
        out('Then re-run: crawlforge init');
        process.exit(1);
      }
      out('API key: found (' + apiKey.slice(0, 8) + '...)');

      // 2. Install skills
      const skillTarget = opts.all ? 'all' : 'claude-code';
      try {
        const results = await install({ target: skillTarget, force: false, cwd: process.cwd() });
        if (results.installed.length > 0) {
          out('Skills installed: ' + results.installed.length + ' file(s)');
        } else {
          out('Skills: already up to date (use crawlforge install-skills --force to overwrite)');
        }
      } catch (err) {
        out('Warning: skill install failed — ' + err.message);
      }

      // 3. MCP stanza merge
      const clientFilter = opts.client || (opts.all ? undefined : 'claude-code');
      const targets = resolveClientPaths(clientFilter);

      for (const { label, path: cfgPath } of targets) {
        try {
          mergeClientConfig(cfgPath, apiKey);
          out('MCP registered: ' + label + ' (' + cfgPath + ')');
        } catch (err) {
          out('Warning: could not update ' + label + ' config — ' + err.message);
        }
      }

      out('Done. Restart your AI client to pick up the crawlforge MCP server.');
      process.exit(0);
    });
}
