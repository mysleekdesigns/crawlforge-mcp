/**
 * challengeDetection.js — re-export of the challenge-vendor tables.
 *
 * The tables moved to crawlforge-extractors 1.7.0 so the REST `scrape` route
 * reaches the same verdict as the MCP server (Phase 0, 0.1). Callers keep
 * importing from here.
 */

export { detectChallengePage } from 'crawlforge-extractors';
export { detectChallengePage as default } from 'crawlforge-extractors';
