// Pick the right adapter for the active tab.

/**
 * @param {import('./index.js').ExtractorAdapter[]} adapters
 * @param {string} hostname
 * @returns {import('./index.js').ExtractorAdapter | null}
 */
export function pickAdapter(adapters, hostname) {
  for (const a of adapters) {
    try {
      if (a.matchHost(hostname)) return a;
    } catch {
      // ignore faulty adapters
    }
  }
  return null;
}
