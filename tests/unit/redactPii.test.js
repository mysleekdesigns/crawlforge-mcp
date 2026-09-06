/**
 * Unit tests for redact_pii (Phase 5, 5.3).
 *
 * Run: node --test tests/unit/redactPii.test.js
 *
 * Contract under test:
 *  - the parameter resolves to the two passes: regex always, model opt-in
 *  - every one of the nine tools' text paths is reached
 *  - the stored-then-read_result path is redacted (the hole this closes)
 *  - the model identifies spans and never rewrites text (G3)
 *  - model mode with no LLM route charges nothing extra (G4)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGEX_ENTITIES, MODEL_ONLY_ENTITIES } from 'crawlforge-extractors';

import {
  REDACT_PII_PARAM,
  REDACT_PII_MODEL_CREDITS,
  REDACTION_TOOLS,
  applyRedaction,
  collectTexts,
  redactionSurcharge,
  resolveRedaction,
  spansFromReply
} from '../../src/server/redaction.js';
import { makeWithAuth } from '../../src/server/withAuth.js';
import { ResultStore, setResultStoreForTests } from '../../src/core/ResultStore.js';
import { readResultHandler } from '../../src/tools/result/readResult.js';
import AuthManager from '../../src/core/AuthManager.js';

const EMAIL_TEXT = 'Reach Dana at dana@example.com or on +1 555 123 4567.';

function makeFakeLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function makeFakeAuth({ toolCost = 2 } = {}) {
  const reportCalls = [];
  return {
    reportCalls,
    isCreatorMode: () => false,
    getToolCost: () => toolCost,
    checkCredits: async () => true,
    projectCost: () => ({ projected: toolCost, note: 'test' }),
    reportUsage: async (...args) => { reportCalls.push(args); }
  };
}

const textOf = (result) => JSON.parse(result.content[0].text);

// ── the parameter ────────────────────────────────────────────────────────────

test('REDACT_PII_PARAM accepts true, an options object, and absence', () => {
  const schema = REDACT_PII_PARAM.redact_pii;
  assert.equal(schema.parse(undefined), undefined);
  assert.equal(schema.parse(true), true);
  assert.deepEqual(schema.parse({ mode: 'model' }), { mode: 'model' });
  assert.deepEqual(
    schema.parse({ entities: ['EMAIL'], replace_style: 'mask', mode: 'fast' }),
    { entities: ['EMAIL'], replace_style: 'mask', mode: 'fast' }
  );
  assert.throws(() => schema.parse({ replace_style: 'delete' }));
  assert.throws(() => schema.parse({ mode: 'llm' }));
});

test('entity names are matched case-insensitively, and omitted/empty means all four', () => {
  const schema = REDACT_PII_PARAM.redact_pii;
  for (const entities of [['EMAIL', 'PHONE'], ['email', 'phone'], ['Financial', 'sEcReT'], []]) {
    assert.equal(schema.safeParse({ entities }).success, true, JSON.stringify(entities));
  }
  assert.equal(schema.safeParse({ entities: ['location'], mode: 'model' }).success, true);
});

test('an unknown entity name is a validation error, not a silent omission', () => {
  const schema = REDACT_PII_PARAM.redact_pii;
  for (const name of ['ADDRESS', 'SSN', 'emial']) {
    const result = schema.safeParse({ entities: ['EMAIL', name] });
    assert.equal(result.success, false, name);
    const issue = result.error.issues[0];
    assert.deepEqual(issue.path, ['entities', 1], 'the message points at the offending element');
    assert.match(issue.message, /^unknown entity name/);
    assert.match(issue.message, /EMAIL, PHONE, FINANCIAL, SECRET/);
  }
  // Still unknown even in model mode — the two failures never blur together.
  const inModelMode = schema.safeParse({ entities: ['ADDRESS'], mode: 'model' });
  assert.equal(inModelMode.success, false);
  assert.match(inModelMode.error.issues[0].message, /^unknown entity name/);
});

test('a model-only entity is rejected unless mode is "model", with its own message', () => {
  const schema = REDACT_PII_PARAM.redact_pii;

  // Asking for PERSON in fast mode would return a page still full of names
  // plus a report that never mentions them. Refuse instead.
  for (const options of [{ entities: ['EMAIL', 'PERSON'] }, { entities: ['EMAIL', 'LOCATION'], mode: 'fast' }]) {
    const result = schema.safeParse(options);
    assert.equal(result.success, false, JSON.stringify(options));
    const issue = result.error.issues[0];
    assert.deepEqual(issue.path, ['entities', 1]);
    assert.match(issue.message, /PERSON and LOCATION need mode: "model"/);
    assert.match(issue.message, new RegExp(`\\+${REDACT_PII_MODEL_CREDITS} credits`));
    assert.doesNotMatch(issue.message, /unknown entity name/, 'the two failures read differently');
  }

  // With mode:"model" the same request is legitimate and must work.
  assert.equal(schema.safeParse({ entities: ['EMAIL', 'PERSON'], mode: 'model' }).success, true);
  assert.equal(schema.safeParse({ entities: ['PERSON'], mode: 'model' }).success, true);
});

test('resolveRedaction: off unless asked for, and true means the free regex pass', () => {
  assert.equal(resolveRedaction(undefined), null);
  assert.equal(resolveRedaction(false), null);
  assert.equal(resolveRedaction('yes'), null);
  assert.equal(resolveRedaction(['EMAIL']), null);

  assert.deepEqual(resolveRedaction(true), {
    entities: [...REGEX_ENTITIES],
    modelEntities: [],
    replaceStyle: 'tag',
    mode: 'fast'
  });
});

test('resolveRedaction: an absent entity list means everything the mode can do', () => {
  assert.deepEqual(resolveRedaction({ mode: 'model' }).modelEntities, [...MODEL_ONLY_ENTITIES]);
  assert.deepEqual(resolveRedaction({ mode: 'model' }).entities, [...REGEX_ENTITIES]);
  // The schema rejects PERSON without mode:"model" outright; this resolver is
  // the tolerant layer beneath it (getToolCost runs on unvalidated params), so
  // it resolves to a selection that redacts nothing rather than throwing.
  assert.deepEqual(resolveRedaction({ entities: ['PERSON'] }).modelEntities, []);
  assert.deepEqual(resolveRedaction({ entities: ['PERSON'] }).entities, []);
});

test('resolveRedaction: an explicit list is honoured exactly and split by pass', () => {
  const resolved = resolveRedaction({ entities: ['email', 'LOCATION'], mode: 'model', replace_style: 'remove' });
  assert.deepEqual(resolved.entities, ['EMAIL']);
  assert.deepEqual(resolved.modelEntities, ['LOCATION']);
  assert.equal(resolved.replaceStyle, 'remove');
});

// ── the credit rule ──────────────────────────────────────────────────────────

test('the regex pass is free; the model pass adds 3 once per call', () => {
  assert.equal(redactionSurcharge('scrape', { redact_pii: true }), 0);
  assert.equal(redactionSurcharge('scrape', { redact_pii: { mode: 'fast' } }), 0);
  assert.equal(redactionSurcharge('scrape', { redact_pii: { mode: 'model' } }), REDACT_PII_MODEL_CREDITS);
  // model mode that asks for no model entity buys no model pass
  assert.equal(redactionSurcharge('scrape', { redact_pii: { mode: 'model', entities: ['EMAIL'] } }), 0);
  // a tool that does not offer the param is never surcharged for it
  assert.equal(redactionSurcharge('fetch_url', { redact_pii: { mode: 'model' } }), 0);
  // read defensively — getToolCost runs before validation
  assert.equal(redactionSurcharge('scrape', { redact_pii: 'model' }), 0);
});

test('getToolCost carries the surcharge on every redaction tool', () => {
  for (const tool of Object.keys(REDACTION_TOOLS)) {
    const base = AuthManager.getToolCost(tool, {});
    assert.equal(AuthManager.getToolCost(tool, { redact_pii: true }), base, `${tool} fast is free`);
    assert.equal(
      AuthManager.getToolCost(tool, { redact_pii: { mode: 'model' } }),
      base + REDACT_PII_MODEL_CREDITS,
      `${tool} model adds ${REDACT_PII_MODEL_CREDITS}`
    );
  }
});

// ── text routing ─────────────────────────────────────────────────────────────

test('collectTexts walks dotted paths and [] array segments', () => {
  const object = { results: [{ content: { text: 'a' } }, { content: { text: 'b' } }, { content: {} }] };
  const found = collectTexts(object, ['results[].content.text']);
  assert.deepEqual(found.map((f) => f.text), ['a', 'b']);
  found[1].set('B');
  assert.equal(object.results[1].content.text, 'B');

  // A missing path, a wrong type, and an array where an object is expected are
  // all no-ops rather than throws.
  assert.deepEqual(collectTexts({}, ['content.markdown']), []);
  assert.deepEqual(collectTexts({ content: 'string' }, ['content.markdown']), []);
  assert.deepEqual(collectTexts({ results: 'nope' }, ['results[].snippet']), []);
});

test('every one of the nine tools redacts its own text shape', async () => {
  const shapes = {
    scrape: [{ content: { markdown: EMAIL_TEXT, rawHtml: EMAIL_TEXT } }, (r) => [r.content.markdown, r.content.rawHtml]],
    extract_content: [{ content: { text: EMAIL_TEXT }, readability: { textContent: EMAIL_TEXT } }, (r) => [r.content.text, r.readability.textContent]],
    extract_text: [{ text: EMAIL_TEXT, markdown: EMAIL_TEXT }, (r) => [r.text, r.markdown]],
    batch_scrape: [{ results: [{ content: { text: EMAIL_TEXT } }] }, (r) => [r.results[0].content.text]],
    crawl_deep: [{ results: [{ content: EMAIL_TEXT }] }, (r) => [r.results[0].content]],
    stealth_mode: [{ content: { markdown: EMAIL_TEXT } }, (r) => [r.content.markdown]],
    scrape_with_actions: [{ content: { html: EMAIL_TEXT } }, (r) => [r.content.html]],
    process_document: [{ content: { text: EMAIL_TEXT } }, (r) => [r.content.text]],
    search_web: [{ results: [{ snippet: EMAIL_TEXT, htmlSnippet: EMAIL_TEXT }] }, (r) => [r.results[0].snippet, r.results[0].htmlSnippet]]
  };
  assert.deepEqual(Object.keys(shapes).sort(), Object.keys(REDACTION_TOOLS).sort());

  for (const [tool, [result, read]] of Object.entries(shapes)) {
    const outcome = await applyRedaction(tool, result, { redact_pii: true });
    assert.equal(outcome.redacted, true, tool);
    for (const value of read(result)) {
      assert.ok(!value.includes('dana@example.com'), `${tool} left an email behind: ${value}`);
      assert.ok(value.includes('<EMAIL>'), `${tool} did not tag the email: ${value}`);
    }
    assert.ok(result.redaction.count >= read(result).length, tool);
    assert.equal(result.redaction.mode, 'fast', tool);
  }
});

test('the search_web batch shape is redacted too', async () => {
  const result = { results_by_query: [{ query: 'a', results: [{ snippet: EMAIL_TEXT }] }] };
  await applyRedaction('search_web', result, { redact_pii: true });
  assert.ok(result.results_by_query[0].results[0].snippet.includes('<EMAIL>'));
});

test('an absent redact_pii leaves the result and its shape untouched', async () => {
  const result = { content: { markdown: EMAIL_TEXT } };
  const outcome = await applyRedaction('scrape', result, {});
  assert.deepEqual(outcome, { redacted: false, modelRan: false });
  assert.deepEqual(result, { content: { markdown: EMAIL_TEXT } });
});

test('replace_style and entities reach the library', async () => {
  const masked = { content: { markdown: EMAIL_TEXT } };
  await applyRedaction('scrape', masked, { redact_pii: { replace_style: 'mask' } });
  assert.ok(masked.content.markdown.includes('[REDACTED]'));

  const emailOnly = { content: { markdown: EMAIL_TEXT } };
  await applyRedaction('scrape', emailOnly, { redact_pii: { entities: ['EMAIL'] } });
  assert.ok(emailOnly.content.markdown.includes('<EMAIL>'));
  assert.ok(emailOnly.content.markdown.includes('+1 555 123 4567'), 'PHONE was not asked for');
  assert.deepEqual(emailOnly.redaction.entities, { EMAIL: 1 });
});

test('a selection of model-only entities redacts nothing by regex, not everything', async () => {
  // redactPii reads an EMPTY entity array as "all four", so a caller asking
  // only for PERSON must not have their emails and phone numbers taken too.
  // The schema refuses this combination at the wire, so this guards the layer
  // beneath it — a pre-validated REST-proxy request, or a direct call.
  const fast = { content: { markdown: EMAIL_TEXT } };
  await applyRedaction('scrape', fast, { redact_pii: { entities: ['PERSON'] } });
  assert.equal(fast.content.markdown, EMAIL_TEXT, 'fast mode with PERSON only changes nothing');
  assert.equal(fast.redaction.count, 0);

  const model = { content: { markdown: EMAIL_TEXT } };
  const complete = async () => ({ text: 'PERSON: Dana' });
  await applyRedaction('scrape', model, { redact_pii: { entities: ['PERSON'], mode: 'model' } }, { complete });
  assert.equal(model.content.markdown, 'Reach <PERSON> at dana@example.com or on +1 555 123 4567.');
  assert.deepEqual(model.redaction.entities, { PERSON: 1 });
});

// ── the model pass ───────────────────────────────────────────────────────────

test('spansFromReply keeps only spans present verbatim in the input (G3)', () => {
  const text = 'Ada Lovelace works in Paris.';
  const spans = spansFromReply(
    'PERSON: Ada Lovelace\nLOCATION: Paris\nPERSON: Grace Hopper\nLOCATION: Atlantis',
    text,
    ['PERSON', 'LOCATION']
  );
  assert.deepEqual(spans.map((s) => text.slice(s.start, s.end)), ['Ada Lovelace', 'Paris']);
  // Nothing the model invented survives.
  assert.equal(spans.length, 2);
});

test('spansFromReply ignores an entity the caller did not ask for, and our own tags', () => {
  const text = 'Ada in Paris, mail <EMAIL>';
  assert.deepEqual(
    spansFromReply('PERSON: Ada\nLOCATION: Paris', text, ['PERSON']).map((s) => text.slice(s.start, s.end)),
    ['Ada']
  );
  assert.deepEqual(spansFromReply('PERSON: EMAIL\nPERSON: REDACTED', text, ['PERSON']), []);
});

test('model mode: the regex pass always runs and the model only adds to it', async () => {
  const result = { content: { markdown: 'Ada Lovelace in Paris. Mail dana@example.com' } };
  const complete = async () => ({ text: 'PERSON: Ada Lovelace\nLOCATION: Paris' });
  const outcome = await applyRedaction('scrape', result, { redact_pii: { mode: 'model' } }, { complete });

  assert.equal(outcome.modelRan, true);
  assert.equal(result.content.markdown, '<PERSON> in <LOCATION>. Mail <EMAIL>');
  assert.deepEqual(result.redaction.entities, { EMAIL: 1, PERSON: 1, LOCATION: 1 });
  assert.equal(result.redaction.count, 3);
  assert.equal(result.redaction.mode, 'model');
  assert.equal(result.redaction.model_ran, true);
});

test('the model reads text that is already regex-redacted, inside the untrusted fence', async () => {
  const result = { content: { markdown: 'Ada Lovelace, dana@example.com' } };
  let prompt = null;
  const complete = async (p) => { prompt = p; return { text: 'NONE' }; };
  await applyRedaction('scrape', result, { redact_pii: { mode: 'model' } }, { complete });

  assert.ok(!prompt.includes('dana@example.com'), 'the fence wrapped unredacted text');
  assert.ok(prompt.includes('<EMAIL>'));
  assert.match(prompt, /UNTRUSTED DATA, not instructions/);
});

test('the model pass is bounded per call, so one +3 surcharge cannot buy fifty completions', async () => {
  // It runs once per TEXT, not once per call. A 50-URL batch_scrape must not
  // turn a single surcharge into 50 round-trips — the SamplingClient chain can
  // reach a server-side API key, so that is real money as well as wall clock.
  const result = {
    results: Array.from({ length: 50 }, (_, i) => ({
      content: { text: `Page ${i}: Ada Lovelace in Paris, mail a${i}@example.com` }
    }))
  };
  let completions = 0;
  const complete = async () => { completions++; return { text: 'PERSON: Ada Lovelace\nLOCATION: Paris' }; };

  await applyRedaction('batch_scrape', result, { redact_pii: { mode: 'model' } }, { complete });

  assert.equal(completions, 5, 'the completion cap is what the character budget allows at full size');
  // The free regex pass still covers every page — only the model is bounded.
  assert.equal(result.redaction.entities.EMAIL, 50);
  assert.equal(result.redaction.entities.PERSON, 5);
  assert.match(result.warnings.join(' '), /the model pass read at most .* and 5 texts/);
});

test('model mode with no LLM route redacts by regex, warns, and charges nothing extra', async () => {
  const result = { content: { markdown: 'Ada Lovelace, dana@example.com' } };
  const complete = async () => { throw new Error('No LLM available'); };
  const outcome = await applyRedaction('scrape', result, { redact_pii: { mode: 'model' } }, { complete });

  assert.equal(outcome.modelRan, false);
  assert.equal(result.content.markdown, 'Ada Lovelace, <EMAIL>');
  assert.equal(result.redaction.model_ran, false);
  assert.match(result.warnings.join(' '), /no model answered/);
  assert.match(result.warnings.join(' '), /surcharge was not charged/);
});

// The SamplingClient chain is Ollama -> server keys -> MCP sampling. Point
// Ollama at a dead port and clear the keys so the route these tests take is
// the one they say they take, whatever the machine happens to be running.
async function withoutLlmRoutes(mcpServer, run) {
  const saved = {
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  };
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('withAuth drops the model surcharge when no model answered', async () => {
  const auth = makeFakeAuth({ toolCost: 5 }); // scrape 2 + the model surcharge 3
  const withAuth = makeWithAuth({ authManager: auth, logger: makeFakeLogger(), mcpServer: null });
  const handler = withAuth('scrape', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ content: { markdown: 'Ada Lovelace, dana@example.com' } }) }]
  }));

  const parsed = await withoutLlmRoutes(null, async () =>
    textOf(await handler({ url: 'https://example.com', redact_pii: { mode: 'model' } })));

  assert.equal(parsed._cost.projected, 5);
  assert.equal(parsed._cost.actual, 2, 'the model surcharge is dropped when nothing completed');
  assert.equal(parsed.redaction.model_ran, false);
  assert.equal(parsed.content.markdown, 'Ada Lovelace, <EMAIL>');
  assert.equal(auth.reportCalls[0][1], 2);
});

test('withAuth charges the model surcharge when a model did answer', async () => {
  const auth = makeFakeAuth({ toolCost: 5 });
  const mcpServer = {
    server: {
      createMessage: async () => ({ content: { type: 'text', text: 'PERSON: Ada Lovelace' } })
    }
  };
  const withAuth = makeWithAuth({ authManager: auth, logger: makeFakeLogger(), mcpServer });
  const handler = withAuth('scrape', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ content: { markdown: 'Ada Lovelace, dana@example.com' } }) }]
  }));

  const parsed = await withoutLlmRoutes(mcpServer, async () =>
    textOf(await handler({ url: 'https://example.com', redact_pii: { mode: 'model' } })));

  assert.equal(parsed._cost.projected, 5);
  assert.equal(parsed._cost.actual, 5, 'the model ran, so the surcharge is charged');
  assert.equal(parsed.redaction.model_ran, true);
  assert.equal(parsed.content.markdown, '<PERSON>, <EMAIL>');
  assert.equal(auth.reportCalls[0][1], 5);
});

test('withAuth never charges the surcharge for the free regex pass', async () => {
  const auth = makeFakeAuth({ toolCost: 2 });
  const withAuth = makeWithAuth({ authManager: auth, logger: makeFakeLogger() });
  const handler = withAuth('scrape', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ content: { markdown: EMAIL_TEXT } }) }]
  }));

  const parsed = textOf(await handler({ url: 'https://example.com', redact_pii: true }));
  assert.equal(parsed._cost.projected, 2);
  assert.equal(parsed._cost.actual, 2);
  assert.equal(parsed.content.markdown.includes('dana@example.com'), false);
});

// ── the ordering that matters ────────────────────────────────────────────────

test('the stored result is redacted, so read_result cannot serve the PII back', async () => {
  const store = new ResultStore({ ttlMs: 60000, maxEntries: 10 });
  setResultStoreForTests(store);
  try {
    const auth = makeFakeAuth({ toolCost: 2 });
    const withAuth = makeWithAuth({ authManager: auth, logger: makeFakeLogger() });
    const big = `${'padding. '.repeat(500)}${EMAIL_TEXT}${' padding.'.repeat(500)}`;
    const handler = withAuth('scrape', async () => ({
      content: [{ type: 'text', text: JSON.stringify({ url: 'https://example.com', content: { markdown: big } }) }]
    }));

    const parsed = textOf(await handler({
      url: 'https://example.com',
      redact_pii: true,
      max_inline_chars: 1000
    }));

    assert.equal(parsed.truncated, true, 'the result was over the threshold and stored');
    assert.ok(parsed.result_handle);
    // The redaction report survives the shaping the threshold stage does.
    assert.equal(parsed.redaction.count, 2);

    const readBack = JSON.parse((await readResultHandler({
      handle: parsed.result_handle,
      operation: 'search',
      query: 'dana@example.com'
    })).content[0].text);
    assert.equal(readBack.total_matches, 0, 'read_result served the PII back out of the store');

    const tagged = JSON.parse((await readResultHandler({
      handle: parsed.result_handle,
      operation: 'search',
      query: '<EMAIL>'
    })).content[0].text);
    assert.equal(tagged.total_matches, 1);
  } finally {
    setResultStoreForTests(null);
  }
});

test('redaction warns that query-format offsets index the pre-redaction text', async () => {
  const result = {
    content: {
      markdown: EMAIL_TEXT,
      highlights: [{ text: EMAIL_TEXT, offset: 0, length: EMAIL_TEXT.length }]
    }
  };
  await applyRedaction('scrape', result, { redact_pii: true });
  assert.ok(result.content.highlights[0].text.includes('<EMAIL>'));
  assert.match(result.warnings.join(' '), /offsets index the text as it was before redaction/);
});
