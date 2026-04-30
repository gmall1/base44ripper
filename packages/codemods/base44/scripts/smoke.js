#!/usr/bin/env node
// scripts/smoke.js — end-to-end smoke test.
// Runs the pokemon-base44-export fixture through the full pipeline, writes the
// result to /tmp/unvibe-smoke/, and prints a summary. Meant to be run
// alongside `pnpm install && pnpm build` in that directory to prove the
// output is a real, buildable project.
//
// Usage: node scripts/smoke.js [outputDir]

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadZipToFileMap } from '@unvibe/detect';
import { transformProject } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../test/fixtures/pokemon-base44-export.zip');

const outputDir = resolve(process.argv[2] ?? '/tmp/unvibe-smoke');

console.log(`[smoke] reading fixture: ${FIXTURE}`);
const buffer = readFileSync(FIXTURE);
const files = await loadZipToFileMap(buffer);

console.log(`[smoke] transforming project...`);
const { files: out, changes, report } = transformProject(files, {
  projectName: 'Pokemon Live Unleashed',
  projectSlug: 'pokemon-live-unleashed',
});

console.log(`[smoke] writing ${Object.keys(out).length} files to: ${outputDir}`);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
for (const [path, content] of Object.entries(out)) {
  const target = join(outputDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

console.log('\n=== detection report ===');
console.log(`  isBase44Export: ${report.isBase44Export}`);
console.log(`  base44Dependencies: ${report.base44Dependencies.join(', ')}`);
console.log(`  entities: ${report.entities.map((e) => e.name).join(', ')}`);
console.log(`  malformedEntities: ${report.malformedEntities.map((m) => m.name).join(', ') || '(none)'}`);
console.log(`  integrationsUsed: ${report.integrationsUsed.join(', ') || '(none)'}`);
console.log(`  hardcodedBase44Urls: ${report.hardcodedBase44Urls.length}`);
console.log(`  source files using entities: ${report.sourceFilesUsingEntities.length}`);
console.log(`  truncated source files: ${report.truncatedSourceFiles.length}`);
for (const t of report.truncatedSourceFiles) {
  console.log(`    - ${t.file} — ${t.reason}`);
}

console.log('\n=== change log ===');
for (const c of changes) console.log(`  - ${c}`);

console.log(`\n[smoke] done. Next: cd ${outputDir} && pnpm install && pnpm build`);
