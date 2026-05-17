/**
 * Unit tests for src/server/registerTool.js (v3.2.0, C3).
 *
 * Run: node --test tests/unit/registerTool.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, dualOutput } from '../../src/server/registerTool.js';

function makeFakeServer() {
  const registrations = [];
  return {
    registrations,
    registerTool(name, options, handler) {
      registrations.push({ name, options, handler });
    }
  };
}

function passthroughWithAuth(_name, handler) {
  return handler;
}

test('registerTool: forwards description, inputSchema, annotations', () => {
  const server = makeFakeServer();
  registerTool(server, passthroughWithAuth, {
    name: 'fetch_url',
    description: 'Fetch a URL',
    inputSchema: { url: 'zod-url-shape' },
    annotations: { readOnlyHint: true },
    handler: async () => ({ content: [] })
  });
  assert.equal(server.registrations.length, 1);
  const reg = server.registrations[0];
  assert.equal(reg.name, 'fetch_url');
  assert.equal(reg.options.description, 'Fetch a URL');
  assert.deepEqual(reg.options.inputSchema, { url: 'zod-url-shape' });
  assert.deepEqual(reg.options.annotations, { readOnlyHint: true });
  // outputSchema should NOT be on the registration when not supplied
  assert.equal('outputSchema' in reg.options, false);
});

test('registerTool: includes outputSchema only when provided', () => {
  const server = makeFakeServer();
  registerTool(server, passthroughWithAuth, {
    name: 'extract_text',
    description: 'd',
    inputSchema: { url: 'x' },
    outputSchema: { text: 'string' },
    handler: async () => ({})
  });
  assert.deepEqual(server.registrations[0].options.outputSchema, { text: 'string' });
});

test('registerTool: wraps handler via withAuth', () => {
  const server = makeFakeServer();
  let wrapped = false;
  const withAuth = (_name, h) => { wrapped = true; return h; };
  registerTool(server, withAuth, {
    name: 't',
    description: 'd',
    inputSchema: {},
    handler: async () => ({})
  });
  assert.equal(wrapped, true);
});

test('dualOutput: produces structuredContent + JSON-stringified content', () => {
  const out = dualOutput({ foo: 'bar', n: 42 });
  assert.deepEqual(out.structuredContent, { foo: 'bar', n: 42 });
  assert.equal(out.content.length, 1);
  assert.equal(out.content[0].type, 'text');
  const parsed = JSON.parse(out.content[0].text);
  assert.deepEqual(parsed, { foo: 'bar', n: 42 });
});
