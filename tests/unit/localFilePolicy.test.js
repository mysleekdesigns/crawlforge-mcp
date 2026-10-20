/**
 * Live sweep 10-20 (1.5): a local process_document read is held to the
 * document extensions and kept out of dot-directories, unless
 * CRAWLFORGE_ALLOWED_DIRS lists the directory. Everything here lives under a
 * fake HOME in os.tmpdir(); the real ~/.crawlforge is never touched.
 * Run: node --test --test-force-exit tests/unit/localFilePolicy.test.js
 */
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildPdf } from '../fixtures/pdfBuilder.js';
import { assertLocalFileAllowed } from '../../src/utils/localFilePolicy.js';
import { ProcessDocumentTool } from '../../src/tools/extract/processDocument.js';

let home, config, link, pdf, passwdLike;
const prevDirs = process.env.CRAWLFORGE_ALLOWED_DIRS;

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-fake-home-'));
  await fs.mkdir(path.join(home, '.crawlforge'));
  await fs.mkdir(path.join(home, 'Downloads'));
  config = path.join(home, '.crawlforge', 'config.json');
  await fs.writeFile(config, JSON.stringify({ apiKey: 'cf_live_FAKE_SECRET' }));
  link = path.join(home, 'Downloads', 'notes.md');
  await fs.symlink(config, link);
  pdf = path.join(home, 'Downloads', 'report.pdf');
  await fs.writeFile(pdf, buildPdf({ pages: ['Quarterly report body text.'] }));
  passwdLike = path.join(home, 'passwd');
  await fs.writeFile(passwdLike, 'root:x:0:0:root:/root:/bin/bash\n');
});

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

afterEach(() => {
  if (prevDirs === undefined) delete process.env.CRAWLFORGE_ALLOWED_DIRS;
  else process.env.CRAWLFORGE_ALLOWED_DIRS = prevDirs;
});

describe('process_document local file policy (default)', () => {
  test('~/.crawlforge/config.json is refused as a dot-directory, for file and pdf_file', async () => {
    const tool = new ProcessDocumentTool();
    for (const sourceType of ['file', 'pdf_file']) {
      const result = await tool.execute({ source: config, sourceType });
      assert.equal(result.success, false);
      assert.match(result.error, /Local file refused: .*dot-directory.*CRAWLFORGE_ALLOWED_DIRS/);
      assert.doesNotMatch(JSON.stringify(result), /FAKE_SECRET/);
    }
  });

  test('a document-type file inside a dot-directory is refused by the dot-directory rule', async () => {
    const md = path.join(home, '.crawlforge', 'notes.md');
    await fs.writeFile(md, 'not for the agent');
    await assert.rejects(assertLocalFileAllowed(md), /dot-directory/);
  });

  test('a symlink with an allowed name pointing at it is refused too', async () => {
    const result = await new ProcessDocumentTool().execute({ source: link, sourceType: 'file' });
    assert.equal(result.success, false);
    assert.match(result.error, /Local file refused/);
    assert.doesNotMatch(JSON.stringify(result), /FAKE_SECRET/);
  });

  test('an extensionless file (/etc/passwd style) is refused by the extension rule', async () => {
    const result = await new ProcessDocumentTool().execute({ source: passwdLike, sourceType: 'file' });
    assert.equal(result.success, false);
    assert.match(result.error, /Local file refused: .*extensionless.*\.pdf, \.docx, \.txt, \.md, \.html/);
  });

  test('a PDF in ~/Downloads still works', async () => {
    const result = await new ProcessDocumentTool().execute({
      source: pdf, sourceType: 'pdf_file', options: { assessContentQuality: false }
    });
    assert.equal(result.success, true, result.error);
    assert.match(result.content.text, /Quarterly report body text/);
  });
});

describe('CRAWLFORGE_ALLOWED_DIRS override', () => {
  test('a listed dot-directory is readable; the extension rule still applies', async () => {
    process.env.CRAWLFORGE_ALLOWED_DIRS = path.join(home, '.crawlforge');
    const result = await new ProcessDocumentTool().execute({ source: config, sourceType: 'file' });
    // .json is not a document extension, so even a listed directory does not open it.
    assert.equal(result.success, false);
    assert.match(result.error, /'\.json' file/);

    const md = path.join(home, '.crawlforge', 'readme.md');
    await fs.writeFile(md, 'Allowed dot-dir note.');
    assert.equal(await assertLocalFileAllowed(md), await fs.realpath(md));
  });

  test('when set, a path outside every listed dir is refused, even a plain PDF', async () => {
    process.env.CRAWLFORGE_ALLOWED_DIRS = [path.join(home, 'Documents'), path.join(home, '.crawlforge')].join(path.delimiter);
    await assert.rejects(assertLocalFileAllowed(pdf), /outside CRAWLFORGE_ALLOWED_DIRS/);
    // A symlink inside a listed dir that points out of it is judged by its target.
    process.env.CRAWLFORGE_ALLOWED_DIRS = path.join(home, 'Downloads');
    const out = path.join(home, 'Downloads', 'escape.txt');
    const target = path.join(home, 'elsewhere.txt');
    await fs.writeFile(target, 'outside');
    await fs.symlink(target, out);
    await assert.rejects(assertLocalFileAllowed(out), /outside CRAWLFORGE_ALLOWED_DIRS/);
  });

  test('a listed dir allows its files', async () => {
    process.env.CRAWLFORGE_ALLOWED_DIRS = path.join(home, 'Downloads');
    const result = await new ProcessDocumentTool().execute({
      source: pdf, sourceType: 'pdf_file', options: { assessContentQuality: false }
    });
    assert.equal(result.success, true, result.error);
  });
});
