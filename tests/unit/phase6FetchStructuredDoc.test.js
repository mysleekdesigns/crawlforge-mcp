/**
 * Live sweep 2026-10-20, Phase 6 minor polish (items 6.4, 6.9, 6.11).
 *
 * Run: node --test --test-force-exit tests/unit/phase6FetchStructuredDoc.test.js
 *
 *  - 6.4 scrape_structured: a field matching several elements inside a row kept
 *    only the first, and @href/@src came back as written (relative). A field
 *    may now be {selector, multiple:true}, and href/src are made absolute.
 *  - 6.9 fetch_url: a result over max_inline_chars dropped `headers` (an
 *    object, so the scalar filter cut it); the result also never said whether
 *    a redirect was followed. Now `headers` stays inline and `redirected` and
 *    `final_url` are reported.
 *  - 6.11 process_document: `title` was null for a PDF with no /Title (arXiv)
 *    and for every DOCX. Now the first heading, else the first short line.
 *
 * Everything runs against a local listener; loopback is allowed via
 * ALLOWED_DOMAINS, set before the first import of src/constants/config.js.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { scrapeStructuredHandler } = await import('../../src/tools/basic/scrapeStructured.js');
const { fetchUrlHandler } = await import('../../src/tools/basic/fetchUrl.js');
const { applyInlineThreshold } = await import('../../src/server/inlineThreshold.js');
const { ResultStore } = await import('../../src/core/ResultStore.js');
const { ProcessDocumentTool, titleFromText } = await import('../../src/tools/extract/processDocument.js');
const { buildPdf } = await import('../fixtures/pdfBuilder.js');
const JSZip = (await import('jszip')).default;

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const LIST_HTML = `<!doctype html><html><body>
  <div class="card">
    <h2>Alpha</h2>
    <a class="tag" href="/tags/one">one</a><a class="tag" href="/tags/two">two</a>
    <img src="img/a.png">
  </div>
  <div class="card">
    <h2>Beta</h2>
    <a class="tag" href="https://other.example/x">x</a>
  </div>
  <div class="card"><h2>Gamma</h2></div>
</body></html>`;

// A .docx with a styles part so mammoth maps "Heading 1" to <h1>.
async function buildDocx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map(({ text, style }) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`).join('') +
    '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

let server;
let baseUrl;
let docxHeading;
let docxPlain;
let arxivPdf;

before(async () => {
  docxHeading = await buildDocx([
    { text: 'Prepared for the board' },
    { text: 'Quarterly Report 2026', style: 'Heading1' },
    { text: 'Revenue grew 12% year over year.' }
  ]);
  docxPlain = await buildDocx([{ text: 'Meeting notes' }, { text: 'Nothing was decided.' }]);
  arxivPdf = buildPdf({ pages: ['Attention Is All You Need'] });
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
    if (req.url === '/list/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(LIST_HTML); return; }
    if (req.url === '/old') { res.writeHead(301, { Location: '/new' }); res.end(); return; }
    if (req.url === '/new' || req.url === '/plain') { res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Probe': 'yes' }); res.end('landed'); return; }
    if (req.url === '/heading.docx') { res.writeHead(200, { 'Content-Type': DOCX_TYPE }); res.end(docxHeading); return; }
    if (req.url === '/plain.docx') { res.writeHead(200, { 'Content-Type': DOCX_TYPE }); res.end(docxPlain); return; }
    if (req.url === '/arxiv.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(arxivPdf); return; }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

const structured = async (params) => {
  const r = await scrapeStructuredHandler({ url: `${baseUrl}/list/page.html`, ...params });
  assert.ok(!r.isError, r.content[0].text);
  return JSON.parse(r.content[0].text);
};

describe('6.4 scrape_structured multiple and absolute URLs', () => {
  test('multiple:true inside a row returns every match; the default keeps the first', async () => {
    const out = await structured({
      row_selector: '.card',
      selectors: { name: 'h2', tags: { selector: 'a.tag', multiple: true }, first_tag: 'a.tag' }
    });
    assert.deepEqual(out.data.map((r) => r.tags), [['one', 'two'], ['x'], []]);
    assert.deepEqual(out.data.map((r) => r.first_tag), ['one', 'x', null], 'string fields keep the single-value shape');
    assert.equal(out.elements_found.tags, 2, 'rows with at least one match');
  });

  test('multiple:true with @href resolves every link against the page URL', async () => {
    const out = await structured({ row_selector: '.card', selectors: { links: { selector: 'a.tag@href', multiple: true } } });
    assert.deepEqual(out.data[0].links, [`${baseUrl}/tags/one`, `${baseUrl}/tags/two`]);
    assert.deepEqual(out.data[1].links, ['https://other.example/x']);
  });

  test('@href and @src come back absolute in both modes', async () => {
    const rows = await structured({ row_selector: '.card', selectors: { img: 'img@src' } });
    assert.equal(rows.data[0].img, `${baseUrl}/list/img/a.png`);
    const flat = await structured({ selectors: { img: 'img@src', tags: 'a.tag@href' } });
    assert.equal(flat.data.img, `${baseUrl}/list/img/a.png`);
    assert.deepEqual(flat.data.tags, [`${baseUrl}/tags/one`, `${baseUrl}/tags/two`, 'https://other.example/x']);
  });

  test('without a row, multiple:true answers with an array even for one match', async () => {
    const out = await structured({ selectors: { img: { selector: 'img@src', multiple: true }, none: { selector: '.missing', multiple: true } } });
    assert.deepEqual(out.data.img, [`${baseUrl}/list/img/a.png`]);
    assert.deepEqual(out.data.none, []);
  });
});

describe('6.9 fetch_url headers when truncated, redirected and final_url', () => {
  test('a followed redirect is reported with the final URL', async () => {
    const r = await fetchUrlHandler({ url: `${baseUrl}/old` });
    const data = JSON.parse(r.content[0].text);
    assert.equal(data.body, 'landed');
    assert.equal(data.redirected, true);
    assert.equal(data.final_url, `${baseUrl}/new`);
  });

  test('no redirect: redirected is false and final_url is the URL asked for', async () => {
    const data = JSON.parse((await fetchUrlHandler({ url: `${baseUrl}/plain` })).content[0].text);
    assert.equal(data.redirected, false);
    assert.equal(data.final_url, `${baseUrl}/plain`);
  });

  test('a truncated result keeps the response headers inline', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-fetch-'));
    const store = new ResultStore({ baseDir });
    const result = {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-probe': 'yes' },
      body: 'x'.repeat(5000),
      url: 'https://example.com/api',
      redirected: false,
      final_url: 'https://example.com/api'
    };
    const { result: shaped, stored } = applyInlineThreshold('fetch_url', result, { max_inline_chars: 1000 }, { store });
    assert.equal(stored, true);
    assert.equal(shaped.truncated, true);
    assert.deepEqual(shaped.headers, result.headers);
    assert.equal(shaped.redirected, false);
    assert.equal(shaped.final_url, 'https://example.com/api');
    fs.rmSync(baseDir, { recursive: true, force: true });
  });
});

describe('6.11 process_document title fallback', () => {
  const tool = new ProcessDocumentTool();

  test('a PDF with no /Title takes its first line', async () => {
    const r = await tool.execute({ source: `${baseUrl}/arxiv.pdf`, sourceType: 'pdf_url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.title, 'Attention Is All You Need');
  });

  test('a DOCX takes its first heading', async () => {
    const r = await tool.execute({ source: `${baseUrl}/heading.docx`, sourceType: 'url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.title, 'Quarterly Report 2026');
  });

  test('a DOCX without headings takes its first short line', async () => {
    const r = await tool.execute({ source: `${baseUrl}/plain.docx`, sourceType: 'url' });
    assert.equal(r.title, 'Meeting notes');
  });

  test('titleFromText skips the arXiv stamp and page numbers, and refuses a paragraph', () => {
    assert.equal(titleFromText('\n arXiv:1706.03762v7 [cs.CL] 2 Aug 2023\n1\nAttention Is All You Need\nAshish Vaswani'), 'Attention Is All You Need');
    assert.equal(titleFromText('word '.repeat(60)), null);
    assert.equal(titleFromText(''), null);
  });
});
