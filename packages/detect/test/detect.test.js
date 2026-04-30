import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { detectFromFileMap, detectFromZip, stripCommonPrefix } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POKEMON_ZIP = resolve(
  __dirname,
  '../../codemods/base44/test/fixtures/pokemon-base44-export.zip',
);

describe('stripCommonPrefix', () => {
  it('strips a shared top-level directory', () => {
    const out = stripCommonPrefix({
      'root/a.js': 'a',
      'root/sub/b.js': 'b',
    });
    expect(out).toEqual({ 'a.js': 'a', 'sub/b.js': 'b' });
  });

  it('leaves the map alone when there is no common prefix', () => {
    const input = { 'a.js': 'a', 'b.js': 'b' };
    expect(stripCommonPrefix(input)).toEqual(input);
  });
});

describe('detectFromFileMap — empty / non-base44', () => {
  it('returns isBase44Export=false for an unrelated project', () => {
    const report = detectFromFileMap({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'src/index.js': 'console.log("hi")',
    });
    expect(report.isBase44Export).toBe(false);
    expect(report.platform).toBe('unknown');
    expect(report.base44Dependencies).toEqual([]);
    expect(report.notes[0]).toMatch(/No Base44 artifacts/);
  });
});

describe('detectFromFileMap — synthetic Base44 shape', () => {
  it('recognises a minimal Base44 export', () => {
    const report = detectFromFileMap({
      'package.json': JSON.stringify({
        dependencies: {
          '@base44/sdk': '^0.8.0',
          '@base44/vite-plugin': '^1.0.0',
          react: '^18.0.0',
        },
      }),
      'vite.config.js': `
        import react from '@vitejs/plugin-react'
        import { defineConfig } from 'vite'
        export default defineConfig({
          plugins: [
            base44({ legacySDKImports: false, hmrNotifier: true }),
            react(),
          ]
        });
      `,
      'src/api/base44Client.js':
        "export const db = { entities: new Proxy({}, { get: () => ({ filter: async () => [], create: async () => ({}) }) }) };",
      'entities/Widget': JSON.stringify({
        name: 'Widget',
        type: 'object',
        properties: { title: { type: 'string' } },
      }),
      'src/pages/Home.jsx':
        "import { db } from '@/api/base44Client';\n" +
        "const rows = await Widget.filter({ published: true });\n" +
        "await Widget.create({ title: 't' });\n" +
        "await UploadFile({ file });\n",
      'src/lib/app-params.js': "export const APP_ID = import.meta.env.VITE_BASE44_APP_ID;",
    });

    expect(report.isBase44Export).toBe(true);
    expect(report.platform).toBe('base44');
    expect(report.base44Dependencies).toContain('@base44/sdk');
    expect(report.base44Dependencies).toContain('@base44/vite-plugin');
    expect(report.viteConfig.hasBase44Plugin).toBe(true);
    expect(report.viteConfig.base44PluginOptions).toEqual(
      expect.arrayContaining(['legacySDKImports', 'hmrNotifier']),
    );
    expect(report.base44Client.present).toBe(true);
    expect(report.base44Client.isNoOpStub).toBe(true);
    expect(report.entities.map((e) => e.name)).toEqual(['Widget']);
    expect(report.base44EnvVarReferences).toEqual(['VITE_BASE44_APP_ID']);
    expect(report.integrationsUsed).toContain('UploadFile');
    expect(report.sourceFilesUsingEntities[0]).toMatchObject({
      file: 'src/pages/Home.jsx',
      calls: 2,
    });
  });
});

describe('detectFromZip — real Base44 export', () => {
  it('produces a full report for the Pokemon Live Unleashed extractor zip', async () => {
    const buffer = readFileSync(POKEMON_ZIP);
    const report = await detectFromZip(buffer);

    expect(report.isBase44Export).toBe(true);
    expect(report.platform).toBe('base44');

    // Both Base44 packages are expected.
    expect(report.base44Dependencies).toEqual(
      expect.arrayContaining(['@base44/sdk', '@base44/vite-plugin']),
    );

    // vite.config.js calls the plugin (and the extractor even forgot the import).
    expect(report.viteConfig.hasBase44Plugin).toBe(true);

    // The no-op Proxy stub is the tell-tale sign of the extractor extension output.
    expect(report.base44Client.present).toBe(true);
    expect(report.base44Client.isNoOpStub).toBe(true);

    // Entities we know from manual inspection of the zip.
    // The `Card` schema is truncated in the extractor output but our repair path
    // should still recover a usable schema for it.
    expect(report.entities.map((e) => e.name).sort()).toEqual([
      'Card',
      'Deck',
      'GameRoom',
      'Match',
      'PlayerRank',
    ]);

    // The truncated Card schema should be surfaced in malformedEntities so the UI
    // can show the user a warning.
    expect(report.malformedEntities.map((e) => e.name)).toEqual(['Card']);

    // The extractor also truncates random .jsx source files. We should surface
    // each one so the user knows exactly which files will break their build.
    expect(report.truncatedSourceFiles.length).toBeGreaterThan(0);
    const truncatedPaths = report.truncatedSourceFiles.map((t) => t.file);
    expect(truncatedPaths).toContain('src/pages/Collection.jsx');
    expect(report.notes.some((n) => /truncated/i.test(n))).toBe(true);

    // Each entity schema parsed into a JSON Schema object with properties.
    for (const entity of report.entities) {
      expect(entity.schema).toHaveProperty('type', 'object');
      expect(entity.schema).toHaveProperty('properties');
    }

    // Source code uses entities heavily.
    expect(report.sourceFilesUsingEntities.length).toBeGreaterThan(0);
    const totalCalls = report.sourceFilesUsingEntities.reduce((s, f) => s + f.calls, 0);
    expect(totalCalls).toBeGreaterThanOrEqual(10);

    // At least one VITE_BASE44_* env var is referenced.
    expect(report.base44EnvVarReferences.length).toBeGreaterThan(0);

    // Summary notes explain the situation.
    expect(report.notes.join(' ')).toMatch(/Base44 export/);
  });
});
