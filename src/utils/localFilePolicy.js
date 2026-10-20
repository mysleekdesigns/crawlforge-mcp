/**
 * Which local files process_document may read (sourceType 'file' / 'pdf_file').
 *
 * A prompt-injected page can talk an agent into reading any path it names, so
 * a local read is held to two rules, both checked on the path's realpath (a
 * symlink is judged by where it points):
 *  - the extension must be one of the document types the tool reads
 *    (pdf, docx, txt, md, html/htm);
 *  - no path segment may start with "." (~/.ssh, ~/.aws, ~/.config,
 *    ~/.crawlforge, ...).
 *
 * CRAWLFORGE_ALLOWED_DIRS (a path.delimiter-separated list of directories)
 * narrows reads to those directories instead: when set, a path is allowed only
 * if its realpath sits inside one of them, and inside them the dot-segment rule
 * does not apply. The extension rule always applies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.html', '.htm'];

async function realpathOr(p) {
  try {
    return await fs.realpath(p);
  } catch {
    return p; // a missing path is judged as given; the read itself reports it
  }
}

/**
 * Resolves `source` and refuses it when the policy above does not allow it.
 * @param {string} source the path the caller passed
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string>} the realpath to read
 */
export async function assertLocalFileAllowed(source, env = process.env) {
  const real = await realpathOr(path.resolve(source));

  const dirs = (env.CRAWLFORGE_ALLOWED_DIRS || '').split(path.delimiter).filter((d) => d.trim());
  if (dirs.length > 0) {
    const roots = await Promise.all(dirs.map((dir) => realpathOr(path.resolve(dir.trim()))));
    if (!roots.some((root) => real.startsWith(root.endsWith(path.sep) ? root : root + path.sep))) {
      throw new Error(
        `Local file refused: '${source}' is outside CRAWLFORGE_ALLOWED_DIRS (${dirs.join(path.delimiter)}). ` +
          'Add its directory to CRAWLFORGE_ALLOWED_DIRS to allow it.'
      );
    }
  } else if (real.split(path.sep).some((segment) => segment.startsWith('.'))) {
    throw new Error(
      `Local file refused: '${source}' resolves to a path inside a dot-directory (${real}), ` +
        'which process_document does not read (they hold credentials and config such as ~/.ssh and ~/.crawlforge). ' +
        'To allow it, list its directory in CRAWLFORGE_ALLOWED_DIRS.'
    );
  }

  const ext = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Local file refused: '${source}' resolves to a ${ext ? `'${ext}'` : 'extensionless'} file, and ` +
        `process_document only reads ${ALLOWED_EXTENSIONS.join(', ')} files from disk.`
    );
  }

  return real;
}
