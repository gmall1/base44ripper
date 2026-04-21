// @unvibe/detect — scan a Base44 export and produce a structured lock-in
// detection report. Pure functions over an in-memory file map so the same code
// runs server-side (API routes), in workers, and in tests.

import JSZip from 'jszip';

/**
 * @typedef {Object} FileMap
 * @description Map of POSIX-style relative paths -> file contents (string or Buffer).
 */

/**
 * @typedef {Object} DetectionReport
 * @property {boolean} isBase44Export
 * @property {'base44'|'unknown'} platform
 * @property {string[]} base44Dependencies                Packages like @base44/sdk, @base44/vite-plugin.
 * @property {Object} viteConfig
 * @property {boolean} viteConfig.hasBase44Plugin
 * @property {string[]} viteConfig.base44PluginOptions    Keys passed to the plugin.
 * @property {Object} base44Client
 * @property {boolean} base44Client.present
 * @property {boolean} base44Client.isNoOpStub            True if it's the Proxy-stub the extractor leaves behind.
 * @property {Array<{name: string, schema: object}>} entities
 * @property {Array<{name: string, reason: string}>} malformedEntities  Entity files the extractor left truncated / unparseable.
 * @property {Array<{file: string, reason: string}>} truncatedSourceFiles  JS/JSX files the extractor appears to have cut off mid-syntax.
 * @property {string[]} hardcodedBase44Urls
 * @property {string[]} base44EnvVarReferences
 * @property {Array<{file: string, calls: number}>} sourceFilesUsingEntities
 * @property {string[]} integrationsUsed                  Subset of UploadFile, InvokeLLM, SendEmail, GenerateImage, SendSMS.
 * @property {string[]} notes                             Human-readable summary lines suitable for UI display.
 */

/** Recognised Base44 npm packages. */
export const BASE44_PACKAGES = ['@base44/sdk', '@base44/vite-plugin'];

/** Integrations the Base44 "Core" SDK exposes that we need to shim. */
export const BASE44_INTEGRATIONS = [
  'UploadFile',
  'InvokeLLM',
  'SendEmail',
  'GenerateImage',
  'SendSMS',
];

const BASE44_URL_PATTERNS = [
  /https?:\/\/[^\s"'`]*\bbase44\.(?:app|com|dev)\b[^\s"'`]*/gi,
  /https?:\/\/[^\s"'`]*\.db\.app\b[^\s"'`]*/gi,
];

const BASE44_ENV_VAR_PATTERN = /\bVITE_BASE44_[A-Z0-9_]+\b/g;

/**
 * Load a zip buffer into a plain FileMap.
 * Directories are skipped. Paths are normalised:
 *  - forward slashes only
 *  - a single common prefix (e.g. "extracted/") is stripped so callers
 *    don't have to know whether the zip was created with or without a root folder.
 *
 * @param {Buffer|Uint8Array} zipBuffer
 * @returns {Promise<FileMap>}
 */
export async function loadZipToFileMap(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  /** @type {FileMap} */
  const raw = {};
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const entry of entries) {
    raw[entry.name] = await entry.async('nodebuffer');
  }
  return stripCommonPrefix(raw);
}

/**
 * If every file in the map shares the same top-level directory
 * (e.g. every path starts with "project/"), strip it.
 *
 * @param {FileMap} map
 * @returns {FileMap}
 */
export function stripCommonPrefix(map) {
  const keys = Object.keys(map);
  if (keys.length === 0) return map;
  const firstSegments = keys.map((k) => k.split('/')[0]);
  const candidate = firstSegments[0];
  const allShare = firstSegments.every((s) => s === candidate);
  // Only strip if every key has at least one more segment beyond the prefix.
  const everyHasMore = keys.every((k) => k.includes('/') && k.split('/').length > 1);
  if (!allShare || !everyHasMore) return map;
  /** @type {FileMap} */
  const out = {};
  const prefix = candidate + '/';
  for (const [k, v] of Object.entries(map)) {
    out[k.slice(prefix.length)] = v;
  }
  return out;
}

/**
 * Convenience wrapper: zip buffer -> DetectionReport.
 * @param {Buffer|Uint8Array} zipBuffer
 */
export async function detectFromZip(zipBuffer) {
  const files = await loadZipToFileMap(zipBuffer);
  return detectFromFileMap(files);
}

/**
 * @param {FileMap} files
 * @returns {DetectionReport}
 */
export function detectFromFileMap(files) {
  const report = {
    isBase44Export: false,
    platform: 'unknown',
    base44Dependencies: [],
    viteConfig: { hasBase44Plugin: false, base44PluginOptions: [] },
    base44Client: { present: false, isNoOpStub: false },
    entities: [],
    malformedEntities: [],
    truncatedSourceFiles: [],
    hardcodedBase44Urls: [],
    base44EnvVarReferences: [],
    sourceFilesUsingEntities: [],
    integrationsUsed: [],
    notes: [],
  };

  detectPackageJson(files, report);
  detectViteConfig(files, report);
  detectBase44Client(files, report);
  detectEntities(files, report);
  detectTextualBase44Refs(files, report);
  detectIntegrationUsage(files, report);
  detectTruncatedSourceFiles(files, report);

  report.isBase44Export =
    report.base44Dependencies.length > 0 ||
    report.viteConfig.hasBase44Plugin ||
    report.base44Client.present ||
    report.entities.length > 0;

  if (report.isBase44Export) {
    report.platform = 'base44';
  }

  buildSummaryNotes(report);
  return report;
}

function detectPackageJson(files, report) {
  const pkgRaw = readText(files['package.json']);
  if (!pkgRaw) return;
  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return;
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const name of BASE44_PACKAGES) {
    if (deps[name]) report.base44Dependencies.push(name);
  }
}

function detectViteConfig(files, report) {
  const vite = readText(files['vite.config.js']) ?? readText(files['vite.config.ts']);
  if (!vite) return;
  if (!/\bbase44\s*\(/.test(vite)) return;
  report.viteConfig.hasBase44Plugin = true;
  // Capture option keys inside the base44({...}) call for transparency.
  const m = vite.match(/base44\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (m) {
    const inside = m[1];
    // Match any `key:` at the top of a line *or* preceded by `{` / `,` so we pick
    // up both multi-line and single-line option literals.
    const keys = [...inside.matchAll(/(?:^|[{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)].map(
      (x) => x[1],
    );
    report.viteConfig.base44PluginOptions = [...new Set(keys)];
  }
}

function detectBase44Client(files, report) {
  const client = readText(files['src/api/base44Client.js']);
  if (!client) return;
  report.base44Client.present = true;
  // The extractor leaves a tell-tale dead Proxy: entities:new Proxy({}, { get:() => ...
  const looksStubbed =
    /entities\s*:\s*new\s+Proxy\s*\(\s*\{\}/.test(client) &&
    /filter\s*:\s*async\s*\(\s*\)\s*=>\s*\[\s*\]/.test(client);
  report.base44Client.isNoOpStub = looksStubbed;
}

function detectEntities(files, report) {
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('entities/')) continue;
    if (path.split('/').length !== 2) continue; // only direct children of entities/
    const name = path.slice('entities/'.length);
    // Entity files ship without extensions; they contain JSON Schema.
    const text = readText(content);
    if (!text) continue;
    let schema;
    try {
      schema = JSON.parse(text);
    } catch (err) {
      // The Base44 extractor sometimes ships truncated entity files (we've seen
      // this in the wild on real exports). Attempt a best-effort repair before
      // giving up so downstream codemods still have *something* to work with.
      const repaired = tryRepairTruncatedJson(text);
      if (repaired) {
        report.entities.push({ name: repaired.name ?? name, schema: repaired });
        report.malformedEntities.push({
          name,
          reason: `JSON truncated by extractor; repaired (${err.message}).`,
        });
        continue;
      }
      report.malformedEntities.push({ name, reason: err.message });
      continue;
    }
    if (!schema || typeof schema !== 'object') continue;
    report.entities.push({ name: schema.name ?? name, schema });
  }
  report.entities.sort((a, b) => a.name.localeCompare(b.name));
  report.malformedEntities.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Best-effort repair of JSON that the extractor truncated mid-property.
 * Closes any dangling quotes / braces so downstream tooling gets a usable
 * schema. Drops the final incomplete property entirely.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function tryRepairTruncatedJson(text) {
  // Strategy: walk the characters tracking brace/bracket depth and string state.
  // Truncate back to the last character that was outside a string and record
  // the current bracket depth. Then close out all open brackets.
  let depth = [];
  let inString = false;
  let escape = false;
  let lastSafeIdx = -1; // index of last char we can safely truncate *after*
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      if (!inString) lastSafeIdx = i;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') {
      depth.push(ch);
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth.pop();
      lastSafeIdx = i;
      continue;
    }
    if (ch === ',') {
      lastSafeIdx = i - 1; // truncate before the comma so we don't need another value
      continue;
    }
  }
  if (lastSafeIdx < 0) return null;
  let head = text.slice(0, lastSafeIdx + 1);
  // Recompute depth for the truncated head.
  depth = [];
  inString = false;
  escape = false;
  for (const ch of head) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth.push(ch);
    else if (ch === '}' || ch === ']') depth.pop();
  }
  while (depth.length) {
    head += depth.pop() === '{' ? '}' : ']';
  }
  try {
    const parsed = JSON.parse(head);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function detectTextualBase44Refs(files, report) {
  const urls = new Set();
  const envs = new Set();
  const entityCalls = /** @type {Map<string, number>} */ (new Map());
  for (const [path, content] of Object.entries(files)) {
    if (!shouldScanForText(path)) continue;
    const text = readText(content);
    if (!text) continue;
    for (const pattern of BASE44_URL_PATTERNS) {
      for (const m of text.matchAll(pattern)) urls.add(m[0]);
    }
    for (const m of text.matchAll(BASE44_ENV_VAR_PATTERN)) envs.add(m[0]);
    // Count calls that look like entity SDK usage. Matches `Card.filter(`, `Deck.list(`,
    // `Match.create(`, etc. where the left-hand side is a PascalCase identifier we know
    // from the entities/ folder.
    if (path.startsWith('src/')) {
      for (const { name } of report.entities) {
        const re = new RegExp(`\\b${escapeRegex(name)}\\.(filter|list|get|create|update|delete|me)\\s*\\(`, 'g');
        const count = [...text.matchAll(re)].length;
        if (count > 0) entityCalls.set(path, (entityCalls.get(path) ?? 0) + count);
      }
    }
  }
  report.hardcodedBase44Urls = [...urls].sort();
  report.base44EnvVarReferences = [...envs].sort();
  report.sourceFilesUsingEntities = [...entityCalls.entries()]
    .map(([file, calls]) => ({ file, calls }))
    .sort((a, b) => b.calls - a.calls);
}

function detectIntegrationUsage(files, report) {
  const used = new Set();
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('src/')) continue;
    const text = readText(content);
    if (!text) continue;
    for (const integration of BASE44_INTEGRATIONS) {
      // Match bare calls to the integration name; conservative but catches the common
      // `base44.integrations.Core.UploadFile(` and `UploadFile(` import forms.
      const re = new RegExp(`\\b${integration}\\s*\\(`);
      if (re.test(text)) used.add(integration);
    }
  }
  report.integrationsUsed = [...used].sort();
}

function buildSummaryNotes(report) {
  const notes = report.notes;
  if (!report.isBase44Export) {
    notes.push('No Base44 artifacts detected — this does not appear to be a Base44 export.');
    return;
  }
  notes.push(
    `Detected Base44 export with ${report.entities.length} entities and ${report.base44Dependencies.length} Base44 npm packages.`,
  );
  if (report.malformedEntities.length > 0) {
    notes.push(
      `${report.malformedEntities.length} entity schema(s) were truncated or corrupted by the extractor and required repair: ${report.malformedEntities
        .map((e) => e.name)
        .join(', ')}.`,
    );
  }
  if (report.truncatedSourceFiles.length > 0) {
    notes.push(
      `${report.truncatedSourceFiles.length} source file(s) appear to have been truncated by the extractor. These will not build until you restore the missing code: ${report.truncatedSourceFiles
        .map((t) => t.file)
        .join(', ')}.`,
    );
  }
  if (report.viteConfig.hasBase44Plugin) {
    notes.push('vite.config.js invokes the Base44 build plugin — build will fail without it installed.');
  }
  if (report.base44Client.isNoOpStub) {
    notes.push('src/api/base44Client.js is a dead Proxy stub — every entity call silently returns empty.');
  }
  if (report.hardcodedBase44Urls.length > 0) {
    notes.push(`${report.hardcodedBase44Urls.length} hard-coded Base44 URLs found.`);
  }
  if (report.base44EnvVarReferences.length > 0) {
    notes.push(
      `Source code references ${report.base44EnvVarReferences.length} VITE_BASE44_* env vars that will need to be replaced.`,
    );
  }
  const totalEntityCalls = report.sourceFilesUsingEntities.reduce((s, f) => s + f.calls, 0);
  if (totalEntityCalls > 0) {
    notes.push(
      `${totalEntityCalls} entity SDK calls across ${report.sourceFilesUsingEntities.length} source files currently no-op.`,
    );
  }
  if (report.integrationsUsed.length > 0) {
    notes.push(`Uses Base44 integrations: ${report.integrationsUsed.join(', ')}.`);
  }
}

// ---------- helpers ----------

function readText(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry;
  if (entry instanceof Uint8Array || Buffer.isBuffer?.(entry)) {
    return Buffer.from(entry).toString('utf8');
  }
  return null;
}

function shouldScanForText(path) {
  if (path.startsWith('node_modules/')) return false;
  if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) return false;
  if (path.endsWith('.ico') || path.endsWith('.svg')) return false;
  if (path.endsWith('.zip')) return false;
  return true;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Heuristic scan for JS/JSX/TS files the extractor appears to have truncated.
 * We don't run a full parser here (too slow, too many dialect edge cases);
 * instead we count braces/parens/brackets outside strings & comments and flag
 * files where the counts don't balance. This catches the common extractor
 * failure mode (file ends mid-function) without false-positiving on well-formed
 * code.
 */
function detectTruncatedSourceFiles(files, report) {
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(path)) continue;
    if (path.startsWith('node_modules/')) continue;
    const text = readText(content);
    if (!text) continue;
    const imbalance = computeBracketImbalance(text);
    if (imbalance.balanced) continue;
    report.truncatedSourceFiles.push({
      file: path,
      reason: imbalance.reason,
    });
  }
  report.truncatedSourceFiles.sort((a, b) => a.file.localeCompare(b.file));
}

function computeBracketImbalance(text) {
  let i = 0;
  let inString = null; // '\'' | '"' | '`' | null
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;
  let inTemplateExpr = 0; // nested ${ ... } inside backticks
  const stack = []; // '{', '(', '['
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        i++;
        continue;
      }
      if (ch === inString) {
        inString = null;
        i++;
        continue;
      }
      if (inString === '`' && ch === '$' && next === '{') {
        inTemplateExpr++;
        stack.push('{');
        inString = null;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // Not in a string/comment.
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      stack.push(ch);
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      const opener = stack.pop();
      const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
      if (opener !== expected) {
        // Mismatched closer; treat as unbalanced so we flag the file.
        return { balanced: false, reason: `Mismatched ${ch} near offset ${i}.` };
      }
      if (ch === '}' && inTemplateExpr > 0) {
        inTemplateExpr--;
        inString = '`';
      }
      i++;
      continue;
    }
    i++;
  }
  if (stack.length === 0 && !inString && !inBlockComment) {
    return { balanced: true };
  }
  const reasons = [];
  if (stack.length > 0) {
    reasons.push(`${stack.length} unclosed bracket(s): ${stack.join('')}`);
  }
  if (inString) reasons.push(`unterminated ${inString} string`);
  if (inBlockComment) reasons.push('unterminated /* */ comment');
  return { balanced: false, reason: reasons.join('; ') };
}
