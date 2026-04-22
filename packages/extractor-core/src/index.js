// @unvibe/extractor-core
//
// Platform-agnostic in-page extractor.
//
// Every vibe-code platform exposes its source through a file tree + a code
// editor. Third-party extractors break in two predictable ways:
//
//  1. The file tree is virtualized (react-window / react-virtual). Rows that
//     have never scrolled into view are never mounted, so a DOM snapshot
//     silently misses most of the project.
//  2. The code editor (Monaco, CodeMirror) also virtualizes lines. Reading
//     `.view-lines` from the DOM gives you the viewport slice, not the file.
//
// This package solves both problems once so each platform adapter only has to
// describe *where* things are on its site, not *how* to harvest them.
//
//   import { extractProject } from '@unvibe/extractor-core';
//   import { base44Adapter } from '@unvibe/extractor-adapter-base44';
//
//   const { files, warnings } = await extractProject(base44Adapter, {
//     onProgress: (p) => console.log(p),
//   });
//
// `files` is the same `FileMap` shape `@unvibe/detect` and `@unvibe/codemods-*`
// already consume, so the zip we hand to the server goes straight through the
// existing pipeline unchanged.

export { harvestFileTree, scrollContainerToEnd } from './tree.js';
export { readFileSourceFor, readAllMonacoModels } from './editor.js';
export { fileMapToZip } from './zip.js';

/**
 * @typedef {Object} ExtractorAdapter
 * @property {string} platformName                       Human-readable platform name ("Base44", "Lovable", "Bolt").
 * @property {(hostname: string) => boolean} matchHost   Returns true if this adapter handles the given hostname.
 * @property {() => HTMLElement | null} getTreeScrollContainer
 *   Return the DOM element whose scrollTop drives the virtualized file tree.
 * @property {() => string} getTreeRowSelector
 *   CSS selector matching every visible file/folder row inside the tree.
 * @property {(row: HTMLElement) => ({ path: string, isFolder: boolean, clickable: HTMLElement } | null)} readTreeRow
 *   Extract metadata from a tree row. Return null to skip (e.g. loading skeletons).
 * @property {(row: HTMLElement) => HTMLElement | null} [getFolderToggle]
 *   Given a folder row, return the element to click to expand it. If omitted,
 *   we assume clicking the row itself toggles the folder.
 * @property {() => Promise<string | null>} [readProjectName]
 *   Optional: read the project name from the page.
 * @property {(path: string) => Promise<string>} readFileSource
 *   Given a path from the tree, return its full source. Usually delegates to
 *   `readFileSourceFor(adapter, path)` from ./editor.js after clicking the row.
 */

/**
 * @typedef {Object} ExtractProgress
 * @property {'scanning-tree' | 'reading-files' | 'zipping' | 'done'} phase
 * @property {number} [filesSeen]
 * @property {number} [filesRead]
 * @property {number} [total]
 * @property {string} [currentPath]
 */

/**
 * @typedef {Object} ExtractOptions
 * @property {(p: ExtractProgress) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {number} [maxFiles]   Safety cap; default 2000.
 */

/**
 * @typedef {Object} ExtractResult
 * @property {Record<string, string | Uint8Array>} files
 * @property {string[]} warnings
 * @property {string} platform
 * @property {string | null} projectName
 */

/**
 * Run the full extraction pipeline against the currently-open page.
 *
 * @param {ExtractorAdapter} adapter
 * @param {ExtractOptions} [options]
 * @returns {Promise<ExtractResult>}
 */
export async function extractProject(adapter, options = {}) {
  const { onProgress = () => {}, signal, maxFiles = 2000 } = options;
  /** @type {string[]} */
  const warnings = [];

  onProgress({ phase: 'scanning-tree' });
  const { paths, skippedFolders } = await (await import('./tree.js')).harvestFileTree(adapter, {
    signal,
    onProgress: (p) => onProgress({ phase: 'scanning-tree', ...p }),
  });
  if (skippedFolders > 0) {
    warnings.push(
      `${skippedFolders} folder(s) failed to expand and may be missing files. Try re-running the extractor after the page finishes loading.`,
    );
  }

  if (paths.length > maxFiles) {
    warnings.push(
      `Project has ${paths.length} files which exceeds the safety cap (${maxFiles}). Only the first ${maxFiles} will be extracted.`,
    );
  }
  const slice = paths.slice(0, maxFiles);

  onProgress({ phase: 'reading-files', filesSeen: slice.length, filesRead: 0, total: slice.length });

  /** @type {Record<string, string>} */
  const files = {};
  for (let i = 0; i < slice.length; i++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const path = slice[i];
    onProgress({ phase: 'reading-files', filesRead: i, total: slice.length, currentPath: path });
    try {
      const source = await adapter.readFileSource(path);
      files[path] = source;
    } catch (err) {
      warnings.push(`Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const projectName = adapter.readProjectName ? await adapter.readProjectName().catch(() => null) : null;

  onProgress({ phase: 'done', filesRead: Object.keys(files).length, total: slice.length });

  return {
    files,
    warnings,
    platform: adapter.platformName,
    projectName,
  };
}
