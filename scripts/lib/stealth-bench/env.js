/**
 * env.js — the header every benchmark run is only meaningful with.
 *
 * Section 2.1 of the review records host, network, engine versions and
 * Playwright version alongside the matrix because all of them move the result:
 * the TCP/IP fingerprint is the host kernel's, the Cloudflare score is mostly
 * the exit IP's, and the rebrowser rows are version-coupled. A matrix without
 * this block cannot be compared with another machine's.
 *
 * The IP classifier is bot.incolumitas.com's own IP API. That page now calls
 * `https://api.ipapi.is/` (the old `api.incolumitas.com/?q=` host answers 404
 * — checked 2026-09-21), and its free tier returns company, ASN and location
 * but no `is_datacenter` flag, so the type is only named when the API names
 * it. The ASN is the answer that matters anyway: AS7922 is a residential
 * Comcast line, a cloud ASN is the hosted instance.
 *
 * The public IP is masked before it reaches a report. These outputs are meant
 * to be committed to docs/ as baselines, and the ASN says everything the
 * benchmark needs without publishing someone's home address.
 */

import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IP_API = 'https://api.ipapi.is/';

/** Last octet / last four hextets replaced: enough to identify a network, not a line. */
function maskIp(ip) {
  if (typeof ip !== 'string') return null;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.x` : ip;
}

function packageVersion(repo, name) {
  try {
    return JSON.parse(readFileSync(resolve(repo, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

async function ipInfo() {
  try {
    const response = await fetch(IP_API, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { type: `unknown (IP API answered ${response.status})` };
    const data = await response.json();
    // The paid tier names the type outright; the free tier does not, and
    // inventing a classification from the company name would be a guess.
    const flags = ['is_datacenter', 'is_vpn', 'is_proxy', 'is_tor', 'is_abuser']
      .filter((flag) => data[flag] === true)
      .map((flag) => flag.replace('is_', ''));
    return {
      type: flags.length ? flags.join(', ') : (data.is_datacenter === false ? 'not datacenter' : 'unclassified (free tier)'),
      ip: maskIp(data.ip),
      company: data.company || null,
      asn: typeof data.asn === 'string' ? data.asn : data.asn?.asn ? `AS${data.asn.asn} ${data.asn.org || ''}`.trim() : null,
      location: [data.city, data.region, data.country].filter(Boolean).join(', ') || null
    };
  } catch (error) {
    return { type: `unknown (API unreachable: ${String(error.message).split('\n')[0]})` };
  }
}

/**
 * @param {string} repo absolute path to the repository root
 * @returns {Promise<object>} the report header, minus browser versions (only
 *   known once an engine has launched — the runner fills `browsers`).
 */
export async function collectEnvironment(repo) {
  let gitCommit = 'unknown';
  try {
    gitCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch { /* not a checkout, or no git — the rest of the header still stands */ }

  let crawlforgeVersion = 'unknown';
  try {
    crawlforgeVersion = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).version;
  } catch { /* leave it unknown */ }

  return {
    timestamp: new Date().toISOString(),
    gitCommit,
    crawlforgeVersion,
    host: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3)
    },
    network: await ipInfo(),
    playwrightVersion: packageVersion(repo, 'playwright') || 'not installed',
    camoufoxVersion: packageVersion(repo, 'camoufox'),
    browsers: {}
  };
}
