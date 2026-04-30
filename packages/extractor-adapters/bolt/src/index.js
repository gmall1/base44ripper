// Bolt.new extractor adapter.
//
// Target: https://bolt.new/~/<project>
//
// Bolt is the easiest of the three: the entire project lives in a
// StackBlitz WebContainer (an in-browser filesystem). StackBlitz exposes a
// JS-accessible filesystem on `window.webcontainerInstance.fs`, and Bolt
// additionally has a "Download" button that emits a complete zip. We prefer
// the download button because it handles binary assets, symlinks, and
// file-permission bits correctly. We only fall back to the Monaco path if
// the user is on a Bolt variant that has removed the button.

import { readFileSourceFor } from '@unvibe/extractor-core/editor';

/** @type {import('@unvibe/extractor-core').ExtractorAdapter} */
export const boltAdapter = {
  platformName: 'Bolt',

  matchHost(hostname) {
    return hostname === 'bolt.new' || hostname.endsWith('.bolt.new') || hostname === 'stackblitz.com';
  },

  getTreeScrollContainer() {
    return (
      document.querySelector('[data-file-explorer] > div') ??
      document.querySelector('[aria-label="Files"] .overflow-auto') ??
      document.querySelector('nav[aria-label="Files"]')
    );
  },

  getTreeRowSelector() {
    return '[data-file-item], [role="treeitem"]';
  },

  readTreeRow(row) {
    const path =
      row.getAttribute('data-file-path') ??
      row.getAttribute('data-path') ??
      (row.textContent ?? '').trim();
    if (!path) return null;
    const isFolder = row.hasAttribute('data-folder') || row.getAttribute('aria-expanded') !== null;
    return { path: path.replace(/^\/+/, ''), isFolder, clickable: /** @type {HTMLElement} */ (row) };
  },

  getFolderToggle(row) {
    return /** @type {HTMLElement | null} */ (
      row.querySelector('button[aria-expanded]') ?? row
    );
  },

  async readProjectName() {
    const el = document.querySelector('[data-project-name], header h1');
    return el ? el.textContent?.trim() ?? null : null;
  },

  async readFileSource(path) {
    // Preferred path: StackBlitz WebContainer filesystem. When available,
    // this returns exact file bytes regardless of what's open in Monaco.
    const fromFs = await readViaWebContainer(path);
    if (fromFs !== null) return fromFs;
    // Fallback: click tree row, read Monaco.
    const row = Array.from(document.querySelectorAll('[data-file-item], [role="treeitem"]')).find(
      (r) =>
        (r.getAttribute('data-file-path') ?? r.getAttribute('data-path')) === path,
    );
    if (row) /** @type {HTMLElement} */ (row).click();
    await new Promise((r) => setTimeout(r, 200));
    return readFileSourceFor(boltAdapter, path);
  },
};

async function readViaWebContainer(path) {
  if (typeof globalThis.__unvibeReadWebContainer === 'function') {
    try {
      const r = await globalThis.__unvibeReadWebContainer(path);
      if (r && r.ok) return r.text;
    } catch {
      // fall through
    }
  }
  return null;
}
