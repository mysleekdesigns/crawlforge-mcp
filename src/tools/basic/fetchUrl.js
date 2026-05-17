/**
 * fetch_url — Basic URL fetching with headers and response handling.
 * Extracted from server.js inline handler.
 */

import { fetchWithTimeout } from './_fetch.js';

/**
 * @param {{ url: string, headers?: Record<string,string>, timeout?: number }} params
 */
export async function fetchUrlHandler({ url, headers, timeout }) {
  try {
    const response = await fetchWithTimeout(url, {
      timeout: timeout || 10000,
      headers: headers || {}
    });

    const body = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body,
          contentType: response.headers.get('content-type') || 'unknown',
          size: body.length,
          url: response.url
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Failed to fetch URL: ${error.message}` }],
      isError: true
    };
  }
}
