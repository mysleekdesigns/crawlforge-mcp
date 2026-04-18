import { isCreatorModeVerified } from './creatorMode.js';

export const ALLOWED_HOSTS = ['www.crawlforge.dev', 'crawlforge.dev', 'api.crawlforge.dev'];

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function resolveApiEndpoint(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid API endpoint URL: "${rawUrl}"`);
  }

  const hostname = parsed.hostname;

  if (LOCALHOST_HOSTS.has(hostname)) {
    if (!isCreatorModeVerified()) {
      throw new Error(`Refusing to use API endpoint "${rawUrl}" — not in allow-list`);
    }
    // Strip trailing slash from pathname
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Refusing to use API endpoint "${rawUrl}" — not in allow-list`);
  }

  if (!ALLOWED_HOSTS.includes(hostname)) {
    throw new Error(`Refusing to use API endpoint "${rawUrl}" — not in allow-list`);
  }

  // Strip trailing slash from pathname
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}
