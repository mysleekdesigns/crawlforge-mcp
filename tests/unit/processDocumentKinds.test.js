/**
 * process_document reads what the server sent, not what the caller guessed.
 *
 * R21 (2026-09-09): calibre's demo.docx fetched with sourceType 'url' went
 * through the HTML pipeline and came back as 1 MB of ZIP bytes with
 * success:true. A DOCX is now read by mammoth, a PDF served under 'url' reaches
 * the PDF parser, and a body this tool cannot read is refused by name.
 *
 * Run: node --test tests/unit/processDocumentKinds.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ALLOWED_DOMAINS = '127.0.0.1';
delete process.env.SSRF_PROTECTION_ENABLED;

const { ProcessDocumentTool, sniffDocumentKind, decodeTextBody } = await import('../../src/tools/extract/processDocument.js');
const { buildPdf } = await import('../fixtures/pdfBuilder.js');
const JSZip = (await import('jszip')).default;

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function buildDocx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
    '</w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

let server;
let baseUrl;
let docx;
let pdf;

before(async () => {
  docx = await buildDocx(['Quarterly report', 'Revenue grew 12% year over year.']);
  pdf = buildPdf({ pages: ['Hello from a PDF served without a pdf sourceType.'], info: { Title: 'Sniffed PDF' } });
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n'); return; }
    if (req.url === '/report.docx') { res.writeHead(200, { 'Content-Type': DOCX_TYPE }); res.end(docx); return; }
    if (req.url === '/report-octet') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(docx); return; }
    if (req.url === '/paper') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); return; }
    if (req.url === '/archive.zip') { res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end(Buffer.concat([Buffer.from('PK', 'latin1'), Buffer.alloc(64, 7)])); return; }
    if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<html><head><title>Plain page</title></head><body><main><p>Just a web page with enough words to count as content for the processor.</p></main></body></html>'); return; }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

describe('sniffDocumentKind', () => {
  test('magic bytes and content types', () => {
    assert.equal(sniffDocumentKind('application/pdf', Buffer.from('%PDF-1.4 ...')), 'pdf');
    assert.equal(sniffDocumentKind('application/octet-stream', Buffer.from('%PDF-1.7')), 'pdf');
    assert.equal(sniffDocumentKind(DOCX_TYPE, Buffer.from('PK', 'latin1')), 'docx');
    assert.equal(sniffDocumentKind('application/octet-stream', Buffer.from('PKxx', 'latin1'), 'https://x.test/a.docx'), 'docx');
    assert.equal(sniffDocumentKind('', Buffer.from('PK word/document.xml', 'latin1')), 'docx');
    assert.equal(sniffDocumentKind('application/zip', Buffer.from('PK', 'latin1')), 'binary');
    assert.equal(sniffDocumentKind('image/png', Buffer.from('PNG', 'latin1')), 'binary');
    assert.equal(sniffDocumentKind('text/html', Buffer.from('<html>')), 'html');
    assert.equal(sniffDocumentKind('', Buffer.from('plain words')), 'html');
    assert.equal(sniffDocumentKind('application/json', Buffer.from('{"a":1}')), 'html');
  });

  test('decodeTextBody honours the charset', () => {
    assert.equal(decodeTextBody(Buffer.from('café', 'latin1'), 'text/html; charset=iso-8859-1'), 'café');
    assert.equal(decodeTextBody(Buffer.from('<meta charset="utf-8"><p>café</p>', 'utf8'), ''), '<meta charset="utf-8"><p>café</p>');
  });
});

describe('process_document by what the server sent', () => {
  const tool = new ProcessDocumentTool();

  test('a .docx under sourceType url is read as a Word document', async () => {
    const r = await tool.execute({ source: `${baseUrl}/report.docx`, sourceType: 'url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.documentType, 'docx');
    assert.match(r.content.text, /Quarterly report/);
    assert.match(r.content.text, /Revenue grew 12% year over year\./);
    assert.doesNotMatch(r.content.text, /Content_Types/, 'no ZIP bytes as text');
  });

  test('a .docx served as octet-stream is recognised by its bytes', async () => {
    const r = await tool.execute({ source: `${baseUrl}/report-octet`, sourceType: 'url', options: { outputFormat: 'markdown' } });
    assert.equal(r.documentType, 'docx');
    assert.match(r.content.markdown, /Quarterly report/);
  });

  test('a PDF under sourceType url reaches the PDF parser', async () => {
    const r = await tool.execute({ source: `${baseUrl}/paper`, sourceType: 'url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.documentType, 'pdf');
    assert.match(r.content.text, /Hello from a PDF/);
  });

  test('a body this tool cannot read is refused by name', async () => {
    const r = await tool.execute({ source: `${baseUrl}/archive.zip`, sourceType: 'url' });
    assert.equal(r.success, false);
    assert.match(r.error, /application\/zip content is not a document this tool reads/);
    assert.match(r.error, /PDF, DOCX, HTML and plain text/);
  });

  test('an HTML page still goes through the page pipeline', async () => {
    const r = await tool.execute({ source: `${baseUrl}/page`, sourceType: 'url' });
    assert.equal(r.success, true, r.error);
    assert.equal(r.documentType, 'web');
    assert.equal(r.title, 'Plain page');
    assert.match(r.content.text, /Just a web page/);
  });
});
