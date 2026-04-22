// Tests for the virtualized-list scroller.
//
// We build a fake virtualized tree: a fixed list of paths, a container whose
// `scrollHeight` is derived from that list, and a `scroll` event handler that
// synthesizes row DOM based on `scrollTop`. This mirrors how react-window
// works closely enough that a scroller that works here works in the browser.

import { describe, it, expect, beforeEach } from 'vitest';
import { harvestFileTree, scrollContainerToEnd } from '../src/tree.js';

function buildVirtualTree(allPaths, { rowHeight = 20, viewport = 200 } = {}) {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.style.height = `${viewport}px`;
  container.style.overflow = 'auto';
  const spacer = document.createElement('div');
  spacer.style.height = `${rowHeight * allPaths.length}px`;
  spacer.style.position = 'relative';
  container.appendChild(spacer);
  document.body.appendChild(container);

  // happy-dom does not run layout, so clientHeight / scrollHeight are not
  // derived from style. Define them explicitly.
  Object.defineProperty(container, 'clientHeight', { value: viewport, configurable: true });
  Object.defineProperty(container, 'scrollHeight', {
    value: rowHeight * allPaths.length,
    configurable: true,
  });

  const render = () => {
    // Remove existing rows (keep spacer).
    for (const el of Array.from(spacer.querySelectorAll('[data-row]'))) el.remove();
    const first = Math.floor(container.scrollTop / rowHeight);
    const last = Math.min(allPaths.length - 1, first + Math.ceil(viewport / rowHeight) + 1);
    for (let i = first; i <= last; i++) {
      const row = document.createElement('div');
      row.setAttribute('data-row', '1');
      row.setAttribute('data-path', allPaths[i].path);
      row.setAttribute('data-folder', allPaths[i].isFolder ? '1' : '0');
      row.style.position = 'absolute';
      row.style.top = `${i * rowHeight}px`;
      row.style.height = `${rowHeight}px`;
      spacer.appendChild(row);
    }
  };

  // Re-render whenever scrollTop changes.
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(container),
    'scrollTop',
  ) ?? { get() { return this._st ?? 0; }, set(v) { this._st = v; } };
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get() {
      return this._st ?? 0;
    },
    set(v) {
      this._st = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
      render();
    },
  });

  render();
  return { container };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('scrollContainerToEnd', () => {
  it('drives the container to its bottom', async () => {
    const allPaths = Array.from({ length: 80 }, (_, i) => ({ path: `src/f${i}.js`, isFolder: false }));
    const { container } = buildVirtualTree(allPaths, { rowHeight: 20, viewport: 200 });
    await scrollContainerToEnd(container, { step: 200 });
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight);
  });

  it('calls onRowsVisible multiple times so callers can collect rows', async () => {
    const allPaths = Array.from({ length: 80 }, (_, i) => ({ path: `src/f${i}.js`, isFolder: false }));
    const { container } = buildVirtualTree(allPaths, { rowHeight: 20, viewport: 200 });
    let calls = 0;
    await scrollContainerToEnd(container, { step: 200, onRowsVisible: () => calls++ });
    expect(calls).toBeGreaterThan(5);
  });
});

describe('harvestFileTree', () => {
  it('collects every file path even though only a slice is mounted at any time', async () => {
    const allPaths = Array.from({ length: 120 }, (_, i) => ({
      path: `src/file-${String(i).padStart(3, '0')}.js`,
      isFolder: false,
    }));
    buildVirtualTree(allPaths, { rowHeight: 20, viewport: 200 });

    const adapter = {
      platformName: 'Test',
      matchHost: () => true,
      getTreeScrollContainer: () => document.body.firstChild,
      getTreeRowSelector: () => '[data-row]',
      readTreeRow: (row) => ({
        path: row.getAttribute('data-path'),
        isFolder: row.getAttribute('data-folder') === '1',
        clickable: row,
      }),
      readFileSource: async () => '',
    };

    const { paths } = await harvestFileTree(adapter);
    expect(paths).toHaveLength(120);
    expect(paths[0]).toBe('src/file-000.js');
    expect(paths[119]).toBe('src/file-119.js');
  });

  it('skips loading-skeleton rows where readTreeRow returns null', async () => {
    const allPaths = Array.from({ length: 40 }, (_, i) => ({
      path: i % 5 === 0 ? '' : `src/real-${i}.js`,
      isFolder: false,
    }));
    buildVirtualTree(allPaths, { rowHeight: 20, viewport: 200 });

    const adapter = {
      platformName: 'Test',
      matchHost: () => true,
      getTreeScrollContainer: () => document.body.firstChild,
      getTreeRowSelector: () => '[data-row]',
      readTreeRow: (row) => {
        const path = row.getAttribute('data-path');
        if (!path) return null;
        return { path, isFolder: false, clickable: row };
      },
      readFileSource: async () => '',
    };

    const { paths } = await harvestFileTree(adapter);
    // 8 skeletons at indexes 0, 5, 10, ... 35 → 32 real files.
    expect(paths).toHaveLength(32);
    expect(paths.every((p) => p.startsWith('src/real-'))).toBe(true);
  });
});
