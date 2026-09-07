/**
 * login command — browser handoff that stores an API key in ~/.crawlforge/config.json.
 *
 * The CLI mints PKCE parameters, prints an approval URL for the human, and polls
 * the website until the signed-in user approves; the key is delivered once, over
 * the poll, and never typed into a terminal. This command stores the credential
 * ONLY — registering the MCP server with a client is `crawlforge init`.
 */
import { randomBytes, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import authManager from '../../core/AuthManager.js';
import { resolveApiEndpoint } from '../../core/endpointGuard.js';

const POLL_INTERVAL_MS = 3000;
const MAX_BACKOFF_MS = 30000;
const MAX_CONSECUTIVE_FAILURES = 10;

export function generateLoginParams() {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    sessionId: randomBytes(16).toString('hex'),
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

export function buildApprovalUrl(endpoint, params, name) {
  return `${endpoint}/cli-auth?session_id=${params.sessionId}` +
    `&code_challenge=${params.codeChallenge}&name=${encodeURIComponent(name)}`;
}

function loginError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Poll the status endpoint until the key arrives. Resolves with the `complete`
 * payload; rejects with an error whose `code` names why (CLI_AUTH_TIMEOUT,
 * CLI_AUTH_VERIFIER_MISMATCH, CLI_AUTH_UNREACHABLE). `sleep` and `now` are
 * injectable so tests neither wait nor hit the network.
 */
export async function pollStatus(fetchImpl, endpoint, params, {
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = 600000,
  requestTimeoutMs = 30000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  let interval = intervalMs;
  let failures = 0;
  let lastFailure = '';

  while (now() < deadline) {
    let response;
    try {
      response = await fetchImpl(`${endpoint}/api/auth/cli/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: params.sessionId, code_verifier: params.codeVerifier }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (err) {
      response = null;
      lastFailure = err.message;
    }

    if (response && response.status === 200) {
      const body = await response.json();
      if (body.status === 'complete') return body;
      if (body.status === 'pending') {
        failures = 0;
      } else {
        failures++;
        lastFailure = `unexpected status "${body.status}"`;
      }
    } else if (response && response.status === 403) {
      let code = 'CLI_AUTH_FORBIDDEN';
      try { code = (await response.json()).error?.code || code; } catch { /* keep default */ }
      throw loginError(code, code === 'CLI_AUTH_VERIFIER_MISMATCH'
        ? 'The website rejected this session\'s verifier. Run crawlforge login again and open the new URL.'
        : `The website refused the login session (${code}).`);
    } else if (response && response.status === 429) {
      interval = Math.min(interval * 2, MAX_BACKOFF_MS);
    } else if (response) {
      failures++;
      lastFailure = `HTTP ${response.status}`;
    } else {
      failures++;
    }

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      throw loginError('CLI_AUTH_UNREACHABLE',
        `Gave up after ${failures} consecutive failed status checks (last: ${lastFailure}).`);
    }
    await sleep(interval);
  }

  throw loginError('CLI_AUTH_TIMEOUT',
    `No approval within ${Math.round(timeoutMs / 1000)} seconds. Run crawlforge login again.`);
}

export function register(program) {
  program
    .command('login')
    .description('Sign in through your browser and store an API key in ~/.crawlforge/config.json (does not touch client configs)')
    .option('--name <name>', 'Name for the API key the approval creates', `CLI on ${hostname()}`)
    // Not `--timeout`: the program-level `--timeout <ms>` parses argv first and
    // would swallow the value, so a subcommand option of that name never gets one.
    .option('--wait <seconds>', 'How long to wait for approval', '600')
    .action(async (opts, cmd) => {
      const json = cmd.parent.opts().json;
      const out = (msg) => process.stderr.write(msg + '\n');
      const fail = (code, message) => {
        if (json) {
          process.stdout.write(JSON.stringify({ status: 'error', code, message }) + '\n', () => process.exit(1));
        } else {
          out('Error: ' + message);
          process.exit(1);
        }
      };
      process.on('SIGINT', () => fail('CLI_AUTH_CANCELLED', 'Login cancelled.'));

      // resolveApiEndpoint() returns the origin with a trailing slash; strip it
      // so the approval URL and the status endpoint are not `host//path`.
      const endpoint = resolveApiEndpoint(process.env.CRAWLFORGE_API_URL || 'https://www.crawlforge.dev').replace(/\/+$/, '');
      const params = generateLoginParams();
      const hadConfig = existsSync(authManager.configPath);

      out('Open this URL in your browser and approve the key (session ' + params.sessionId.slice(0, 8) + '):');
      out('');
      out('  ' + buildApprovalUrl(endpoint, params, opts.name));
      out('');
      out('Waiting for approval… (Ctrl-C to cancel)');

      let result;
      try {
        result = await pollStatus(fetch, endpoint, params, {
          timeoutMs: parseInt(opts.wait, 10) * 1000,
          requestTimeoutMs: parseInt(process.env.CRAWLFORGE_CLI_TIMEOUT || '30000', 10),
        });
      } catch (err) {
        return fail(err.code || 'CLI_AUTH_FAILED', err.message);
      }

      const validation = await authManager.validateApiKey(result.api_key);
      if (!validation.valid) {
        return fail('CLI_AUTH_KEY_INVALID', 'The delivered API key failed validation: ' + validation.error);
      }
      await authManager.saveConfig(result.api_key, validation.userId, validation.email);

      if (json) {
        const line = JSON.stringify({
          status: 'complete',
          email: validation.email,
          key_name: result.key_name,
          config_path: authManager.configPath,
          credits_remaining: validation.creditsRemaining,
          plan: validation.planId,
        });
        process.stdout.write(line + '\n', () => process.exit(0));
        return;
      }

      out('Signed in as ' + validation.email);
      out('Credits remaining: ' + validation.creditsRemaining);
      out('Plan: ' + validation.planId);
      out('API key "' + result.key_name + '" saved to ' + authManager.configPath +
        (hadConfig ? ' (replaced the previous config)' : ''));
      out('Next: crawlforge init --client claude-code|claude-desktop|cursor registers the MCP server with a client (this command did not modify any client config).');
      process.exit(0);
    });
}
