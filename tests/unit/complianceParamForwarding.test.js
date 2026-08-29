/**
 * Ground rule G5/G4: a tool that declares COMPLIANCE_PARAMS must actually pass
 * them to its implementation.
 *
 * The defect this guards against is invisible from outside: server.js wraps
 * several tools in an inline handler that destructures a fixed parameter list
 * and re-packs it for execute(). Any declared parameter missing from that list
 * is accepted at the MCP boundary, validated, and then silently dropped — so
 * `respect_robots: false` and `user_agent` were honoured by the schema, the
 * docs and the tool itself, and by nothing in between.
 *
 * Found 2026-08-29 on five tools at once (extract_structured, map_site,
 * extract_content, process_document, stealth_mode), which is why this is a
 * guard and not five fixes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js');
const COMPLIANCE = ['respect_robots', 'user_agent'];

/**
 * Tools allowed to declare a compliance parameter and not forward it, with the
 * reason. An entry here is a decision, not a pass — check it before adding one.
 */
const EXEMPT = {
  // stealth_mode's browser generates its User-Agent from a fingerprint persona
  // (StealthBrowserManager.selectRealisticUserAgent) and derives Sec-CH-UA and
  // the OS profile from it. Injecting a caller's UA would desynchronise the
  // fingerprint, which is both a worse product and a fingerprinting tell.
  // respect_robots IS forwarded — only the UA is inapplicable.
  stealth_mode: ['user_agent']
};

function toolBlocks(src) {
  return src.split('\nregisterToolIfEnabled(').slice(1).map((block) => {
    const name = block.match(/^"([^"]+)"/)?.[1];
    const [descriptor, ...rest] = block.split('withAuth(');
    return { name, descriptor, handler: rest.join('withAuth(').split('\n}));')[0] };
  });
}

describe('G5: declared compliance params reach the tool', () => {
  const declaring = toolBlocks(readFileSync(SERVER, 'utf8'))
    .filter((t) => t.name && t.descriptor.includes('COMPLIANCE_PARAMS'));

  test('the fixture finds the tools it is meant to police', () => {
    assert.ok(declaring.length >= 14, `only found ${declaring.length} tools declaring COMPLIANCE_PARAMS`);
  });

  for (const tool of declaring) {
    test(`${tool.name} forwards respect_robots and user_agent`, () => {
      const exempt = EXEMPT[tool.name] || [];
      const inline = tool.handler.match(/^"[^"]+",\s*async\s*\(\{([^}]*)\}\)/);

      if (inline) {
        const names = inline[1].split(',').map((n) => n.trim().split(/[:=]/)[0].trim());
        for (const param of COMPLIANCE) {
          if (exempt.includes(param)) continue;
          assert.ok(
            names.includes(param),
            `${tool.name} destructures a fixed list that omits "${param}", so it is accepted and dropped. ` +
            'Take (params) and forward it whole, or add the name.'
          );
        }
        return;
      }

      // Takes the params object whole — make sure it is not re-packed into a
      // literal on the way to execute(), which drops the same parameters.
      const repacked = tool.handler.match(/\.execute\(\{([^}]*)\}\)/);
      if (repacked) {
        const keys = repacked[1].split(',').map((n) => n.trim().split(/[:=]/)[0].trim());
        for (const param of COMPLIANCE) {
          if (exempt.includes(param)) continue;
          assert.ok(keys.includes(param), `${tool.name} re-packs execute() args and drops "${param}"`);
        }
      }
    });
  }
});
