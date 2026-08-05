/**
 * Minimal hand-rolled PDF writer for test fixtures — no external PDF library
 * is installed (pdf-parse pulls in pdfjs-dist as a *reader*, not a writer),
 * so real, byte-valid PDFs are constructed here directly. Used by
 * tests/unit/tools/extract/processDocument.test.js to exercise the real
 * pdf-parse 2.x (PDFParse class) code path end-to-end instead of stubbing it.
 *
 * buildPdf() produces a classic, unencrypted multi-page PDF with one
 * Helvetica text line per page and an optional /Info dictionary.
 *
 * buildEncryptedPdf() additionally applies the PDF Standard Security Handler
 * (Revision 2, 40-bit RC4 — ISO 32000-1 Algorithms 3.1-3.4) by hand, since
 * Node's OpenSSL 3 build has no RC4 cipher (`crypto.getCiphers()` excludes
 * it) and no PDF-writer package is installed to lean on instead.
 */
import crypto from 'node:crypto';

function escapePdfString(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function layoutObjectNumbers(n, hasInfo) {
  const catalogNum = 1;
  const pagesNum = 2;
  const pageNums = [];
  for (let i = 0; i < n; i++) pageNums.push(3 + i);
  const fontNum = 3 + n;
  const contentNums = [];
  for (let i = 0; i < n; i++) contentNums.push(4 + n + i);
  const infoNum = hasInfo ? 4 + 2 * n : null;
  return { catalogNum, pagesNum, pageNums, fontNum, contentNums, infoNum };
}

function serialize(objects, catalogNum, infoNum, extraTrailerParts = []) {
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const chunks = [header];
  let offset = header.length;
  const offsets = new Map();
  const maxObjNum = Math.max(...objects.keys());

  for (let num = 1; num <= maxObjNum; num++) {
    const obj = objects.get(num);
    if (obj === undefined) continue;
    offsets.set(num, offset);
    let buf;
    if (obj.type === 'stream') {
      const head = Buffer.from(`${num} 0 obj\n<< /Length ${obj.data.length} >>\nstream\n`, 'latin1');
      const tail = Buffer.from(`\nendstream\nendobj\n`, 'latin1');
      buf = Buffer.concat([head, obj.data, tail]);
    } else {
      buf = Buffer.from(`${num} 0 obj\n${obj.body}\nendobj\n`, 'latin1');
    }
    chunks.push(buf);
    offset += buf.length;
  }

  const xrefOffset = offset;
  const xrefLines = [`xref`, `0 ${maxObjNum + 1}`, `0000000000 65535 f `];
  for (let num = 1; num <= maxObjNum; num++) {
    const off = offsets.get(num);
    xrefLines.push(off === undefined ? '0000000000 00000 f ' : `${String(off).padStart(10, '0')} 00000 n `);
  }
  const trailerParts = [`/Size ${maxObjNum + 1}`, `/Root ${catalogNum} 0 R`, ...extraTrailerParts];
  if (infoNum) trailerParts.push(`/Info ${infoNum} 0 R`);
  const trailer = `trailer\n<< ${trailerParts.join(' ')} >>\nstartxref\n${xrefOffset}\n%%EOF`;

  chunks.push(Buffer.from(xrefLines.join('\n') + '\n' + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

/**
 * @param {Object} opts
 * @param {string[]} opts.pages - one text line per page
 * @param {{Title?: string, Author?: string}} [opts.info]
 * @returns {Buffer}
 */
export function buildPdf({ pages, info } = {}) {
  const pageTexts = pages && pages.length ? pages : ['Empty page.'];
  const n = pageTexts.length;
  const { catalogNum, pagesNum, pageNums, fontNum, contentNums, infoNum } = layoutObjectNumbers(n, !!info);

  const objects = new Map();
  objects.set(catalogNum, { type: 'dict', body: `<< /Type /Catalog /Pages ${pagesNum} 0 R >>` });
  objects.set(pagesNum, { type: 'dict', body: `<< /Type /Pages /Kids [${pageNums.map(p => `${p} 0 R`).join(' ')}] /Count ${n} >>` });
  for (let i = 0; i < n; i++) {
    objects.set(pageNums[i], {
      type: 'dict',
      body: `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNums[i]} 0 R >>`
    });
  }
  objects.set(fontNum, { type: 'dict', body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` });
  for (let i = 0; i < n; i++) {
    const text = escapePdfString(pageTexts[i]);
    const data = Buffer.from(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`, 'latin1');
    objects.set(contentNums[i], { type: 'stream', data });
  }
  if (info) {
    const parts = [];
    if (info.Title) parts.push(`/Title (${escapePdfString(info.Title)})`);
    if (info.Author) parts.push(`/Author (${escapePdfString(info.Author)})`);
    objects.set(infoNum, { type: 'dict', body: `<< ${parts.join(' ')} >>` });
  }

  return serialize(objects, catalogNum, infoNum);
}

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

function padPassword(pw) {
  const buf = Buffer.from(pw, 'latin1').subarray(0, 32);
  return Buffer.concat([buf, PAD], 32).subarray(0, 32);
}

function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function md5(...bufs) {
  const h = crypto.createHash('md5');
  for (const b of bufs) h.update(b);
  return h.digest();
}

function computeStandardSecurity(userPassword, ownerPassword, fileId, permissions, keyLenBytes = 5) {
  const ownerDigest = md5(padPassword(ownerPassword));
  const O = rc4(ownerDigest.subarray(0, keyLenBytes), padPassword(userPassword));

  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(permissions, 0);
  const keyDigest = md5(padPassword(userPassword), O, pBuf, fileId);
  const encryptionKey = keyDigest.subarray(0, keyLenBytes);

  const U = rc4(encryptionKey, PAD);
  return { O, U, encryptionKey };
}

function encryptObject(encryptionKey, objNum, genNum, data) {
  const extra = Buffer.from([
    objNum & 0xff, (objNum >> 8) & 0xff, (objNum >> 16) & 0xff,
    genNum & 0xff, (genNum >> 8) & 0xff
  ]);
  const digest = md5(encryptionKey, extra);
  const objKey = digest.subarray(0, Math.min(encryptionKey.length + 5, 16));
  return rc4(objKey, data);
}

/**
 * Builds a PDF encrypted with the Standard Security Handler (R2, 40-bit RC4).
 * @param {Object} opts
 * @param {string[]} opts.pages - one text line per page
 * @param {{Title?: string, Author?: string}} [opts.info]
 * @param {string} opts.userPassword - password required to open/read the PDF
 * @param {string} [opts.ownerPassword] - defaults to userPassword, per spec
 * @returns {Buffer}
 */
export function buildEncryptedPdf({ pages, info, userPassword, ownerPassword } = {}) {
  const pageTexts = pages && pages.length ? pages : ['Empty page.'];
  const n = pageTexts.length;
  const { catalogNum, pagesNum, pageNums, fontNum, contentNums, infoNum } = layoutObjectNumbers(n, !!info);
  const encryptNum = (infoNum || contentNums[contentNums.length - 1]) + 1;

  const fileId = crypto.randomBytes(16);
  const permissions = -4; // allow everything; R2 reserved bits must be 1
  const { O, U, encryptionKey } = computeStandardSecurity(
    userPassword, ownerPassword || userPassword, fileId, permissions, 5
  );

  const objects = new Map();
  objects.set(catalogNum, { type: 'dict', body: `<< /Type /Catalog /Pages ${pagesNum} 0 R >>` });
  objects.set(pagesNum, { type: 'dict', body: `<< /Type /Pages /Kids [${pageNums.map(p => `${p} 0 R`).join(' ')}] /Count ${n} >>` });
  for (let i = 0; i < n; i++) {
    objects.set(pageNums[i], {
      type: 'dict',
      body: `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNums[i]} 0 R >>`
    });
  }
  objects.set(fontNum, { type: 'dict', body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` });
  for (let i = 0; i < n; i++) {
    const plain = Buffer.from(`BT /F1 24 Tf 72 700 Td (${escapePdfString(pageTexts[i])}) Tj ET`, 'latin1');
    objects.set(contentNums[i], { type: 'stream', data: encryptObject(encryptionKey, contentNums[i], 0, plain) });
  }
  if (info) {
    const fields = [];
    if (info.Title) fields.push(`/Title <${encryptObject(encryptionKey, infoNum, 0, Buffer.from(info.Title, 'latin1')).toString('hex')}>`);
    if (info.Author) fields.push(`/Author <${encryptObject(encryptionKey, infoNum, 0, Buffer.from(info.Author, 'latin1')).toString('hex')}>`);
    objects.set(infoNum, { type: 'dict', body: `<< ${fields.join(' ')} >>` });
  }
  objects.set(encryptNum, {
    type: 'dict',
    body: `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${permissions} >>`
  });

  const idHex = fileId.toString('hex');
  return serialize(objects, catalogNum, infoNum, [
    `/Encrypt ${encryptNum} 0 R`,
    `/ID [<${idHex}> <${idHex}>]`
  ]);
}
