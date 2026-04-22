// Package a FileMap into a zip Blob suitable for download from the extension
// popup or upload to the upload portal.

import JSZip from 'jszip';

/**
 * @param {Record<string, string | Uint8Array>} files
 * @param {{ rootFolder?: string }} [opts]
 * @returns {Promise<Blob>}
 */
export async function fileMapToZip(files, opts = {}) {
  const { rootFolder } = opts;
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    const entryPath = rootFolder ? `${rootFolder}/${path}` : path;
    zip.file(entryPath, content);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Node-compatible variant for tests. Returns a Uint8Array.
 *
 * @param {Record<string, string | Uint8Array>} files
 * @param {{ rootFolder?: string }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function fileMapToZipBytes(files, opts = {}) {
  const { rootFolder } = opts;
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    const entryPath = rootFolder ? `${rootFolder}/${path}` : path;
    zip.file(entryPath, content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
