// Page-world script. Runs in the host page's JS context (not the isolated
// content-script world) so it can read `window.monaco` / CodeMirror / the
// StackBlitz WebContainer filesystem.
//
// Content-script code reaches us via `window.postMessage` — that's the only
// cross-world channel available without `scripting.executeScript` calls.

(function () {
  if (window.__unvibeBridgeInstalled) return;
  window.__unvibeBridgeInstalled = true;

  window.__unvibeReadMonaco = function (path) {
    try {
      if (!window.monaco || !window.monaco.editor) return { ok: false, reason: 'no-monaco' };
      const models = window.monaco.editor.getModels();
      for (const m of models) {
        const p = m && m.uri && (m.uri.path || m.uri.toString());
        if (!p) continue;
        if (p === path || p.endsWith(path) || path.endsWith(p)) {
          return { ok: true, text: m.getValue() };
        }
      }
      return {
        ok: false,
        reason: 'no-matching-model',
        paths: models.map((m) => m && m.uri && (m.uri.path || m.uri.toString())),
      };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  };

  window.__unvibeReadAllMonaco = function () {
    try {
      if (!window.monaco || !window.monaco.editor) return { ok: false, reason: 'no-monaco', models: [] };
      const models = window.monaco.editor.getModels().map((m) => ({
        path: m && m.uri && (m.uri.path || m.uri.toString()),
        text: m.getValue(),
      }));
      return { ok: true, models };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e), models: [] };
    }
  };

  window.__unvibeReadCodeMirror = function () {
    try {
      const el = document.querySelector('.cm-content');
      const view = el && el.cmView && el.cmView.view;
      if (!view) return { ok: false, reason: 'no-codemirror' };
      return { ok: true, text: view.state.doc.toString() };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  };

  window.__unvibeReadWebContainer = async function (path) {
    try {
      const wc = window.webcontainerInstance || window.__stackblitz_webcontainer || null;
      if (!wc || !wc.fs) return { ok: false, reason: 'no-webcontainer' };
      const buf = await wc.fs.readFile(path, 'utf8');
      return { ok: true, text: buf };
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) };
    }
  };
})();
