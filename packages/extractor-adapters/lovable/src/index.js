// Lovable.dev extractor adapter.
//
// Target: https://lovable.dev/projects/<id>  (code view)
//
// Lovable's editor is also Monaco. File tree lives in a left rail, rows are
// react-virtual divs with `data-path`. Lovable additionally exposes the full
// project tree via their GitHub integration; if a user has connected GitHub
// they can pull the repo directly and skip the extractor entirely — the
// extension popup should suggest that before falling back to scraping.

import { readFileSourceFor } from '@unvibe/extractor-core/editor';

/** @type {import('@unvibe/extractor-core').ExtractorAdapter} */
export const lovableAdapter = {
  platformName: 'Lovable',

  matchHost(hostname) {
    return hostname === 'lovable.dev' || hostname.endsWith('.lovable.dev') || hostname === 'gpteng.co';
  },

  getTreeScrollContainer() {
    return (
      document.querySelector('[data-testid="file-explorer"] [data-virtual-scroll]') ??
      document.querySelector('.FileExplorer__list') ??
      document.querySelector('nav[aria-label="Project files"]')
    );
  },

  getTreeRowSelector() {
    return '[data-file-row], [role="treeitem"]';
  },

  readTreeRow(row) {
    const path = row.getAttribute('data-path') ?? row.getAttribute('data-file-path') ?? (row.textContent ?? '').trim();
    if (!path) return null;
    const isFolder = row.hasAttribute('data-folder') || row.getAttribute('aria-expanded') !== null;
    return { path: path.replace(/^\/+/, ''), isFolder, clickable: /** @type {HTMLElement} */ (row) };
  },

  getFolderToggle(row) {
    return /** @type {HTMLElement | null} */ (
      row.querySelector('button[aria-label^="Toggle"], button[aria-expanded]') ?? row
    );
  },

  async readProjectName() {
    const el = document.querySelector('[data-testid="project-title"], header h1');
    return el ? el.textContent?.trim() ?? null : null;
  },

  async readFileSource(path) {
    const row = Array.from(document.querySelectorAll('[data-file-row], [role="treeitem"]')).find(
      (r) => (r.getAttribute('data-path') ?? r.getAttribute('data-file-path')) === path,
    );
    if (row) /** @type {HTMLElement} */ (row).click();
    await new Promise((r) => setTimeout(r, 200));
    return readFileSourceFor(lovableAdapter, path);
  },
};
