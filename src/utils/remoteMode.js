/**
 * Is this process serving a network that is not just the machine it runs on?
 *
 * The distinction matters for tools that touch the local filesystem. Over
 * stdio, and over HTTP bound to loopback, the caller *is* the local user:
 * reading a file they name is the feature, and no privilege boundary is
 * crossed. Bound to a public interface it is a different act entirely — the
 * caller is remote and the filesystem is the server's, so the same request
 * reads files that were never theirs to read.
 *
 * The two expressions below are deliberately identical to the places that
 * actually decide the transport and the bind address:
 *   - `server.js` (`useHttp`), and
 *   - `src/server/transports/streamableHttp.js` (`host` / `hostIsLoopback`).
 * Keep them in step. Erring toward "remote" is the safe direction: it refuses
 * a local-file read that would have been allowed, which is a visible,
 * reversible inconvenience rather than a silent disclosure.
 */
export function isRemoteTransport() {
  const useHttp = process.argv.includes('--http') || process.env.MCP_HTTP === 'true';
  if (!useHttp) return false; // stdio — the caller is the local user

  const host = process.env.MCP_HTTP_HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  return !(host === '127.0.0.1' || host === '::1' || host === 'localhost');
}
