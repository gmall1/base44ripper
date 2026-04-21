// Editor content readers.
//
// The two editors in practical use across vibe-code platforms are:
//
//  - Monaco (VS Code's editor). Exposes `window.monaco.editor.getModels()`
//    which returns `ITextModel` objects; each has `.uri.path` and a
//    `.getValue()` that returns the **full** text regardless of viewport.
//    This is a clean escape hatch: once a file has been opened once, its
//    model stays cached and we can read it without any DOM scraping.
//
//  - CodeMirror 6. The active view is reachable through
//    `document.querySelector('.cm-content').cmView.view.state.doc.toString()`.
//    CodeMirror does not keep non-active editors in memory, so we can only
//    read the file that is currently open.
//
// Either way, the caller's job is to make the target file the active file
// (usually by clicking its tree row) before calling `readCurrentFileSource`.

/** @type {Promise<void> | null} */
let _bridgeInstalled = null;

/**
 * A page-context bridge. MV3 content scripts run in an isolated world and
 * cannot touch `window.monaco` directly; we have to inject a small script
 * into the page world that reads the model and posts the result back.
 *
 * Callers in Node/jsdom tests can stub `globalThis.__unvibeReadMonaco` to
 * bypass the bridge.
 */
async function ensurePageBridge() {
  if (_bridgeInstalled) return _bridgeInstalled;
  _bridgeInstalled = new Promise((resolve) => {
    if (typeof globalThis.__unvibeReadMonaco === 'function') {
      resolve();
      return;
    }
    if (typeof document === 'undefined' || !document.documentElement) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.textContent = `
      (function () {
        if (window.__unvibeReadMonaco) return;
        window.__unvibeReadMonaco = function (path) {
          try {
            if (!window.monaco || !window.monaco.editor) return { ok: false, reason: 'no-monaco' };
            var models = window.monaco.editor.getModels();
            for (var i = 0; i < models.length; i++) {
              var m = models[i];
              var p = m && m.uri && (m.uri.path || m.uri.toString());
              if (!p) continue;
              if (p === path || p.endsWith(path) || path.endsWith(p)) {
                return { ok: true, text: m.getValue() };
              }
            }
            return { ok: false, reason: 'no-matching-model', paths: models.map(function (m) { return m && m.uri && (m.uri.path || m.uri.toString()); }) };
          } catch (e) {
            return { ok: false, reason: String(e && e.message || e) };
          }
        };
        window.__unvibeReadAllMonaco = function () {
          try {
            if (!window.monaco || !window.monaco.editor) return { ok: false, reason: 'no-monaco', models: [] };
            var models = window.monaco.editor.getModels().map(function (m) {
              return { path: m && m.uri && (m.uri.path || m.uri.toString()), text: m.getValue() };
            });
            return { ok: true, models: models };
          } catch (e) {
            return { ok: false, reason: String(e && e.message || e), models: [] };
          }
        };
        window.__unvibeReadCodeMirror = function () {
          try {
            var el = document.querySelector('.cm-content');
            var view = el && el.cmView && el.cmView.view;
            if (!view) return { ok: false, reason: 'no-codemirror' };
            return { ok: true, text: view.state.doc.toString() };
          } catch (e) {
            return { ok: false, reason: String(e && e.message || e) };
          }
        };
      })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
    resolve();
  });
  return _bridgeInstalled;
}

/**
 * Read the source of the file whose tree row was most recently clicked,
 * using whichever editor is active on the page.
 *
 * @param {import('./index.js').ExtractorAdapter} adapter
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function readFileSourceFor(adapter, path) {
  await ensurePageBridge();
  // Monaco first — it's the common case and gives us full file content.
  const fromMonaco = invokePageFn('__unvibeReadMonaco', path);
  if (fromMonaco && fromMonaco.ok) return fromMonaco.text;
  // Fall back to CodeMirror (single active document).
  const fromCM = invokePageFn('__unvibeReadCodeMirror');
  if (fromCM && fromCM.ok) return fromCM.text;
  // Last resort: scrape the viewport DOM. Lossy — will be flagged as a
  // truncatedSourceFile by @unvibe/detect downstream.
  const textAreas = document.querySelectorAll('.view-lines, .cm-content');
  if (textAreas.length > 0) return textAreas[0].textContent ?? '';
  throw new Error(
    `Could not read source for ${path}. Tried Monaco model, CodeMirror state, DOM viewport — all empty.`,
  );
}

/**
 * Batch variant: returns all Monaco models currently loaded in the page as
 * a FileMap. Useful when the editor has already visited every file (e.g.
 * because we clicked every tree row) and we want to avoid round-tripping.
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function readAllMonacoModels() {
  await ensurePageBridge();
  const r = invokePageFn('__unvibeReadAllMonaco');
  if (!r || !r.ok) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const { path, text } of r.models) {
    if (!path || typeof text !== 'string') continue;
    const norm = path.replace(/^\//, '');
    out[norm] = text;
  }
  return out;
}

function invokePageFn(name, ...args) {
  if (typeof globalThis[name] === 'function') {
    try {
      return globalThis[name](...args);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}
