// Tree-scroll harvester.
//
// Virtualized lists (react-window, react-virtual, etc.) only mount rows that
// are inside the visible viewport. To enumerate the full file tree we have to
// physically scroll the container from top to bottom, collecting every row we
// see as we go, and expanding folders as they appear.
//
// We keep this file DOM-only (no chrome.* APIs, no platform knowledge) so it
// is unit-testable under happy-dom.

/**
 * Harvest the full list of file paths from a virtualized file tree.
 *
 * @param {import('./index.js').ExtractorAdapter} adapter
 * @param {{ signal?: AbortSignal, onProgress?: (p: { filesSeen: number }) => void }} [opts]
 * @returns {Promise<{ paths: string[], skippedFolders: number }>}
 */
export async function harvestFileTree(adapter, opts = {}) {
  const { signal, onProgress = () => {} } = opts;
  /** @type {Set<string>} */
  const seenPaths = new Set();
  /** @type {Set<string>} */
  const expandedFolders = new Set();
  let skippedFolders = 0;

  // Some trees lazy-render folder contents only after the folder is clicked.
  // We loop: scroll-to-end, collect, expand any un-expanded folders, repeat
  // until a pass produces no new rows.
  for (let iteration = 0; iteration < 30; iteration++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const before = seenPaths.size;
    const container = adapter.getTreeScrollContainer();
    if (!container) {
      // Tree not mounted yet. Wait briefly and retry.
      await sleep(150);
      continue;
    }

    await scrollContainerToEnd(container, {
      onRowsVisible: () => collectVisibleRows(adapter, seenPaths, onProgress),
      signal,
    });

    // Expand any folders we haven't expanded yet.
    const folders = listFolderRows(adapter);
    let expandedThisPass = 0;
    for (const folder of folders) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const folderRow = folder.row;
      if (expandedFolders.has(folder.path)) continue;
      const toggle = adapter.getFolderToggle ? adapter.getFolderToggle(folderRow) : folderRow;
      if (!toggle) {
        skippedFolders++;
        expandedFolders.add(folder.path);
        continue;
      }
      try {
        toggle.click();
        await sleep(60);
        expandedFolders.add(folder.path);
        expandedThisPass++;
      } catch {
        skippedFolders++;
      }
    }

    const after = seenPaths.size;
    if (after === before && expandedThisPass === 0) break;
  }

  const paths = [...seenPaths].sort();
  return { paths, skippedFolders };
}

function collectVisibleRows(adapter, seenPaths, onProgress) {
  const rows = Array.from(document.querySelectorAll(adapter.getTreeRowSelector()));
  for (const row of rows) {
    const info = adapter.readTreeRow(row);
    if (!info) continue;
    if (info.isFolder) continue;
    if (!info.path) continue;
    if (!seenPaths.has(info.path)) {
      seenPaths.add(info.path);
      onProgress({ filesSeen: seenPaths.size });
    }
  }
}

function listFolderRows(adapter) {
  const rows = Array.from(document.querySelectorAll(adapter.getTreeRowSelector()));
  const out = [];
  for (const row of rows) {
    const info = adapter.readTreeRow(row);
    if (!info || !info.isFolder || !info.path) continue;
    out.push({ row, path: info.path });
  }
  return out;
}

/**
 * Scroll a container from top to bottom in small increments, calling
 * `onRowsVisible` after each step so callers can collect virtualized items
 * before they unmount.
 *
 * @param {HTMLElement} container
 * @param {{ onRowsVisible?: () => void, step?: number, signal?: AbortSignal }} [opts]
 */
export async function scrollContainerToEnd(container, opts = {}) {
  const { onRowsVisible = () => {}, step = 200, signal } = opts;
  container.scrollTop = 0;
  await sleep(40);
  onRowsVisible();

  let lastScrollTop = -1;
  let stable = 0;
  for (let i = 0; i < 1000; i++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    container.scrollTop = container.scrollTop + step;
    await sleep(40);
    onRowsVisible();
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (container.scrollTop >= maxScroll - 1) break;
    if (container.scrollTop === lastScrollTop) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
      lastScrollTop = container.scrollTop;
    }
  }
  // Final pass at the bottom to catch the last page.
  onRowsVisible();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
