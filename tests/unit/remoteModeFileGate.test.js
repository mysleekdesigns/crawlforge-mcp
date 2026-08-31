/**
 * Local-file source types are refused on a remote transport.
 *
 * `process_document` reads `source` off the local disk for sourceType 'file'
 * and 'pdf_file'. Run yourself over stdio, that is the feature. Served on a
 * public interface, the same call is arbitrary file read on the host, so the
 * transport decides whether it is allowed.
 *
 * Run: node --test tests/unit/remoteModeFileGate.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { isRemoteTransport } from '../../src/utils/remoteMode.js';
import { ProcessDocumentTool } from '../../src/tools/extract/processDocument.js';

const ENV_KEYS = ['MCP_HTTP', 'MCP_HTTP_HOST', 'RENDER'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('isRemoteTransport', () => {
  test('stdio is not remote', () => {
    assert.equal(isRemoteTransport(), false);
  });

  test('HTTP bound to loopback is not remote', () => {
    process.env.MCP_HTTP = 'true';
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    assert.equal(isRemoteTransport(), false);
  });

  test('HTTP defaults to loopback when no host is set', () => {
    process.env.MCP_HTTP = 'true';
    assert.equal(isRemoteTransport(), false);
  });

  test('HTTP bound to a public interface is remote', () => {
    process.env.MCP_HTTP = 'true';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    assert.equal(isRemoteTransport(), true);
  });

  test('Render sets the public bind implicitly', () => {
    process.env.MCP_HTTP = 'true';
    process.env.RENDER = 'true';
    assert.equal(isRemoteTransport(), true);
  });
});

describe('process_document local-file gate', () => {
  for (const sourceType of ['file', 'pdf_file']) {
    test(`refuses sourceType '${sourceType}' on a remote transport`, async () => {
      process.env.MCP_HTTP = 'true';
      process.env.MCP_HTTP_HOST = '0.0.0.0';

      const tool = new ProcessDocumentTool();
      const result = await tool.execute({ source: '/etc/passwd', sourceType });

      assert.equal(result.success, false);
      assert.match(result.error, /only available when this server runs on your own machine/);
      // The refusal must come from the gate, not from the filesystem: a "no such
      // file" here would mean the read was attempted and merely happened to miss.
      assert.doesNotMatch(result.error, /ENOENT|no such file/i);
    });
  }

  test("still reads a local file over stdio, where it is the feature", async () => {
    const tool = new ProcessDocumentTool();
    const result = await tool.execute({
      source: new URL('./remoteModeFileGate.test.js', import.meta.url).pathname,
      sourceType: 'file',
    });

    // Whatever the processing pipeline makes of it, the gate must not be what
    // stopped it.
    if (result.error) {
      assert.doesNotMatch(result.error, /only available when this server runs/);
    }
  });
});
