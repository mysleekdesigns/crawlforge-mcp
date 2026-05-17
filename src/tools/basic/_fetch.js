/**
 * Shared HTTP fetch helper for basic tools.
 * Applies an AbortController timeout and a default User-Agent.
 */

/**
 * Fetch a URL with a configurable timeout.
 * @param {string} url
 * @param {{ timeout?: number, headers?: Record<string,string> }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, headers = {} } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CrawlForge/1.0.0',
        ...headers
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  }
}
