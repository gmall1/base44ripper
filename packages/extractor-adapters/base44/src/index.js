// Base44 extractor adapter.
//
// Target: https://app.base44.app/apps/<project>/code
//
// Base44's editor is VS Code (Monaco) wrapped in a React file-tree panel. The
// tree uses a virtualized list, which is why naive scrapers miss most files.
// Selectors here are based on the live DOM at the time of writing; keep them
// close to the user-visible markup (data-*, aria-*, role) so they survive
// minor Base44 style refactors.
//
// NOTE: Each selector is listed with a primary and one or two fallbacks. If
// all of them miss, the extension popup will surface "no tree found" to the
// user with a link to report the mismatch.

import { readFileSourceFor } from '@unvibe/extractor-core/editor';

/** @type {import('@unvibe/extractor-core').ExtractorAdapter} */
export const base44Adapter = {
  platformName: 'Base44',

  matchHost(hostname) {
    return hostname === 'base44.app' || hostname.endsWith('.base44.app');
  },

  getTreeScrollContainer() {
    // The file-tree panel is a react-window list wrapped in a scroller div.
    return (
      document.querySelector('[data-testid="file-tree-scroll"]') ??
      document.querySelector('.FileTree__scroll') ??
      document.querySelector('aside[aria-label="Files"] [role="tree"]')?.parentElement ??
      null
    );
  },

  getTreeRowSelector() {
    // Every tree row (file + folder) has role="treeitem".
    return '[role="treeitem"]';
  },

  readTreeRow(row) {
    // Path is stored on `data-path` in current markup. If that's missing,
    // fall back to the visible text.
    const path = row.getAttribute('data-path') ?? row.getAttribute('data-file-path') ?? textContent(row);
    if (!path) return null;
    const expanded = row.getAttribute('aria-expanded');
    const isFolder = expanded !== null; // files don't set aria-expanded
    const clickable = /** @type {HTMLElement} */ (row.querySelector('[role="button"]') ?? row);
    return { path: normalizePath(path), isFolder, clickable };
  },

  getFolderToggle(row) {
    return /** @type {HTMLElement | null} */ (
      row.querySelector('[data-testid="folder-toggle"]') ??
        row.querySelector('button[aria-expanded]') ??
        row
    );
  },

  async readProjectName() {
    const el = document.querySelector('[data-testid="project-name"], header h1');
    return el ? el.textContent?.trim() ?? null : null;
  },

  async readFileSource(path) {
    // Click the row to make Monaco open this file if it hasn't been opened yet.
    const row = findRowForPath(path);
    if (row) {
      const clickable = /** @type {HTMLElement} */ (row.querySelector('[role="button"]') ?? row);
      clickable.click();
      // Wait for Monaco to mount / swap models.
      await waitForMonacoModel(path, 5000);
    }
    return readFileSourceFor(base44Adapter, path);
  },
};

function findRowForPath(path) {
  const rows = Array.from(document.querySelectorAll('[role="treeitem"]'));
  for (const row of rows) {
    const rowPath = row.getAttribute('data-path') ?? row.getAttribute('data-file-path');
    if (rowPath === path) return /** @type {HTMLElement} */ (row);
  }
  return null;
}

function normalizePath(p) {
  if (!p) return p;
  // Base44 paths are sometimes prefixed with "/" — normalize to relative.
  return p.replace(/^\/+/, '');
}

function textContent(el) {
  return (el.textContent ?? '').trim();
}

async function waitForMonacoModel(path, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (typeof globalThis.__unvibeReadMonaco === 'function') {
      const r = globalThis.__unvibeReadMonaco(path);
      if (r && r.ok) return;
    } else if (typeof window !== 'undefined' && typeof window.__unvibeReadMonaco === 'function') {
      const r = window.__unvibeReadMonaco(path);
      if (r && r.ok) return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}
