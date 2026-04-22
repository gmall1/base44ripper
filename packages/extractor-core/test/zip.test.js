import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { fileMapToZipBytes } from '../src/zip.js';

describe('fileMapToZipBytes', () => {
  it('round-trips a small FileMap through zip and back', async () => {
    const files = {
      'package.json': '{"name":"demo"}',
      'src/index.js': 'export const x = 1;\n',
      'public/logo.png': new Uint8Array([1, 2, 3, 4]),
    };
    const bytes = await fileMapToZipBytes(files);
    const zip = await JSZip.loadAsync(bytes);
    const roundTrip = {};
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const text = await entry.async('string');
      roundTrip[entry.name] = text;
    }
    expect(Object.keys(roundTrip).sort()).toEqual([
      'package.json',
      'public/logo.png',
      'src/index.js',
    ]);
    expect(roundTrip['package.json']).toBe('{"name":"demo"}');
    expect(roundTrip['src/index.js']).toBe('export const x = 1;\n');
  });

  it('supports a rootFolder wrapper', async () => {
    const bytes = await fileMapToZipBytes({ 'a.txt': 'hi' }, { rootFolder: 'my-project' });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('my-project/a.txt')).not.toBeNull();
  });
});
