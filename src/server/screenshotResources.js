/**
 * screenshotResources — move a scrape_with_actions result's screenshot bytes
 * out of the inline result and into crawlforge://screenshot/{actionId}
 * resources.
 *
 * The tool carries the same base64 in up to four places: `screenshots`,
 * `actionResults[].result` (screenshot actions), `content.screenshots`
 * (formats:["screenshots"] copies the same array) and `attempts[].results`
 * (one per chain attempt). Stripping only the first left the others inline
 * (Phase 0, 0.4). Each actionId is published once.
 */

/**
 * @param {object} result - the tool result, mutated in place
 * @param {(actionId: string, data: string) => void} publish - stores the base64
 * @returns {object} the same result
 */
export function stripScreenshotData(result, publish) {
  const published = new Set();

  const strip = (shot, actionId) => {
    if (!actionId || typeof shot?.data !== 'string') return shot;
    if (!published.has(actionId)) {
      publish(actionId, shot.data);
      published.add(actionId);
    }
    const { data, ...rest } = shot;
    return { ...rest, resourceUri: `crawlforge://screenshot/${actionId}` };
  };

  const stripResults = (results) => results.map((r) => (
    r?.type === 'screenshot' ? { ...r, result: strip(r.result, r.id) } : r
  ));

  if (Array.isArray(result.screenshots)) {
    result.screenshots = result.screenshots.map((shot) => strip(shot, shot?.actionId));
  }
  if (Array.isArray(result.content?.screenshots)) {
    result.content.screenshots = result.content.screenshots.map((shot) => strip(shot, shot?.actionId));
  }
  if (Array.isArray(result.actionResults)) {
    result.actionResults = stripResults(result.actionResults);
  }
  if (Array.isArray(result.attempts)) {
    result.attempts = result.attempts.map((a) => (
      Array.isArray(a?.results) ? { ...a, results: stripResults(a.results) } : a
    ));
  }
  return result;
}
