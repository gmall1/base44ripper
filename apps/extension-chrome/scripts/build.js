// Bundles the content script (which imports workspace packages) into a single
// self-contained file, and copies the rest of the extension sources into
// `dist/` in the shape Chrome expects when loading an unpacked extension.

import { build, context } from 'esbuild';
import { copyFile, mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');

const WATCH = process.argv.includes('--watch');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const sharedOpts = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  logLevel: 'info',
  legalComments: 'none',
};

const entries = [
  { in: join(SRC, 'content.js'), out: join(DIST, 'content.js') },
  { in: join(SRC, 'background.js'), out: join(DIST, 'background.js') },
  { in: join(SRC, 'popup/popup.js'), out: join(DIST, 'popup/popup.js') },
];

async function buildOne(entry) {
  await build({
    ...sharedOpts,
    entryPoints: [entry.in],
    outfile: entry.out,
  });
}

if (WATCH) {
  const ctxs = await Promise.all(
    entries.map((e) =>
      context({ ...sharedOpts, entryPoints: [e.in], outfile: e.out }),
    ),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[unvibe] watching for changes…');
} else {
  for (const entry of entries) await buildOne(entry);
}

// Copy static assets.
await cp(join(SRC, 'manifest.json'), join(DIST, 'manifest.json'));
await cp(join(SRC, 'page-bridge.js'), join(DIST, 'page-bridge.js'));
await cp(join(SRC, 'popup/popup.html'), join(DIST, 'popup/popup.html'));
await cp(join(SRC, 'popup/popup.css'), join(DIST, 'popup/popup.css'));

// Icons: if we don't have real PNGs yet, emit 1x1 transparent placeholders so
// the extension still loads. Replace with real assets before shipping.
await mkdir(join(DIST, 'icons'), { recursive: true });
const iconsSrc = join(SRC, 'icons');
if (existsSync(iconsSrc)) {
  await cp(iconsSrc, join(DIST, 'icons'), { recursive: true });
} else {
  const PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  for (const size of [16, 48, 128]) {
    await writeFile(join(DIST, 'icons', `icon-${size}.png`), PLACEHOLDER_PNG);
  }
}

console.log('[unvibe] built extension to', DIST);
