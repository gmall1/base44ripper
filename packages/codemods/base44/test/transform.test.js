import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZipToFileMap } from '@unvibe/detect';
import {
  transformProject,
  transformPackageJson,
  transformViteConfig,
  transformAppParams,
  transformIndexHtml,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, 'fixtures/pokemon-base44-export.zip');

describe('transformPackageJson', () => {
  it('strips Base44 deps and renames the package', () => {
    const files = {
      'package.json': JSON.stringify({
        name: 'base44-app',
        dependencies: {
          '@base44/sdk': '^0.8.0',
          '@base44/vite-plugin': '^1.0.0',
          react: '^18.0.0',
        },
      }),
    };
    const changes = [];
    transformPackageJson(files, { projectSlug: 'my-app' }, changes);
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.dependencies['@base44/sdk']).toBeUndefined();
    expect(pkg.dependencies['@base44/vite-plugin']).toBeUndefined();
    expect(pkg.dependencies.react).toBe('^18.0.0');
    expect(pkg.name).toBe('my-app');
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('transformViteConfig', () => {
  it('replaces a vite config that invokes the Base44 plugin', () => {
    const files = {
      'vite.config.js':
        "import react from '@vitejs/plugin-react';\n" +
        "export default defineConfig({ plugins: [base44({ hmrNotifier: true }), react()] });",
    };
    const changes = [];
    transformViteConfig(files, changes);
    expect(files['vite.config.js']).not.toMatch(/base44\s*\(/);
    expect(files['vite.config.js']).toMatch(/react\s*\(\)/);
    expect(changes).toEqual(['Rewrote vite.config.js — dropped the @base44/vite-plugin call.']);
  });
});

describe('transformAppParams', () => {
  it('renames VITE_BASE44_* refs and base44_ storage keys', () => {
    const files = {
      'src/lib/app-params.js':
        "const key = 'base44_token';\n" +
        "const appId = import.meta.env.VITE_BASE44_APP_ID;\n",
    };
    const changes = [];
    transformAppParams(files, changes);
    expect(files['src/lib/app-params.js']).not.toMatch(/VITE_BASE44_/);
    expect(files['src/lib/app-params.js']).not.toMatch(/base44_/);
    expect(files['src/lib/app-params.js']).toMatch(/VITE_APP_APP_ID/);
    expect(changes).toHaveLength(1);
  });
});

describe('transformIndexHtml', () => {
  it('strips the extractor preamble and rewrites title + favicon', () => {
    const files = {
      'index.html':
        'const db = globalThis.__B44_DB__ || {};\n\n<!doctype html>\n' +
        '<html><head><link rel="icon" href="https://db.com/logo_v2.svg" /><title>Base44 APP</title></head><body></body></html>',
    };
    const changes = [];
    transformIndexHtml(files, { projectName: 'My Cool App' }, changes);
    expect(files['index.html']).toMatch(/^<!doctype html>/);
    expect(files['index.html']).toMatch(/<title>My Cool App<\/title>/);
    expect(files['index.html']).not.toMatch(/db\.com/);
    expect(files['index.html']).toMatch(/favicon\.svg/);
    expect(changes).toHaveLength(1);
  });
});

describe('transformProject — full pipeline on the Pokemon zip', () => {
  it('produces a cleaned, runnable-shaped project tree', async () => {
    const buffer = readFileSync(FIXTURE);
    const files = await loadZipToFileMap(buffer);

    const { files: out, changes, report } = transformProject(files, {
      projectName: 'Pokemon Live Unleashed',
      projectSlug: 'pokemon-live-unleashed',
    });

    // The detection report should have marked this as a Base44 export.
    expect(report.isBase44Export).toBe(true);
    expect(report.entities.length).toBeGreaterThanOrEqual(5);

    // Base44 npm packages are gone from the output package.json.
    const pkg = JSON.parse(out['package.json']);
    expect(pkg.name).toBe('pokemon-live-unleashed');
    expect(pkg.dependencies['@base44/sdk']).toBeUndefined();
    expect(pkg.dependencies['@base44/vite-plugin']).toBeUndefined();
    // Real deps the customer wants to keep are preserved.
    expect(pkg.dependencies.react).toBeDefined();
    expect(pkg.dependencies['react-router-dom']).toBeDefined();

    // vite.config.js no longer invokes the Base44 plugin.
    expect(out['vite.config.js']).not.toMatch(/\bbase44\s*\(/);
    expect(out['vite.config.js']).toMatch(/@vitejs\/plugin-react/);

    // base44Client.js now re-exports from the local runtime, not a dead Proxy.
    const clientSrc = out['src/api/base44Client.js'];
    expect(clientSrc).toMatch(/from '@\/lib\/localDb\.js'/);
    expect(clientSrc).not.toMatch(/new Proxy/);

    // The local runtime was injected.
    expect(out['src/lib/localDb.js']).toMatch(/export const db/);
    expect(out['src/lib/localDb.js']).toMatch(/localStorage/);

    // Entity schemas file exists and contains the expected names.
    const schemasSrc = out['src/lib/_entitySchemas.generated.js'];
    expect(schemasSrc).toMatch(/export const entitySchemas/);
    for (const name of ['Card', 'Deck', 'GameRoom', 'Match', 'PlayerRank']) {
      expect(schemasSrc).toContain(`"${name}"`);
    }

    // Named entity exports for the `@/api/entities` import shape.
    const entitiesSrc = out['src/api/entities.js'];
    expect(entitiesSrc).toMatch(/export const Card = entities\.Card;/);
    expect(entitiesSrc).toMatch(/export const Deck = entities\.Deck;/);

    // app-params env vars renamed.
    expect(out['src/lib/app-params.js']).not.toMatch(/VITE_BASE44_/);
    expect(out['src/lib/app-params.js']).toMatch(/VITE_APP_/);

    // index.html cleaned.
    expect(out['index.html']).toMatch(/<title>Pokemon Live Unleashed<\/title>/);
    expect(out['index.html']).not.toMatch(/db\.com\/logo_v2/);
    expect(out['index.html']).toMatch(/^<!doctype html>/);

    // Fresh README was generated and mentions the platform of origin.
    expect(out['README.md']).toMatch(/ejected from \[Base44\]/);
    expect(out['README.md']).toMatch(/pnpm install/);

    // .env.example reflects the renamed env vars.
    expect(out['.env.example']).toMatch(/VITE_APP_/);
    expect(out['.env.example']).not.toMatch(/VITE_BASE44_/);

    // The change log isn't empty and mentions the major categories.
    expect(changes.some((c) => /package\.json/.test(c))).toBe(true);
    expect(changes.some((c) => /vite\.config/.test(c))).toBe(true);
    expect(changes.some((c) => /localDb/.test(c))).toBe(true);
    expect(changes.some((c) => /README/.test(c))).toBe(true);

    // Source files the user actually wrote should pass through unchanged
    // (we pick a representative non-config file).
    expect(out['src/lib/gameEngine.js']).toBeDefined();
    expect(out['src/pages/DeckBuilder.jsx']).toBeDefined();
  });
});
