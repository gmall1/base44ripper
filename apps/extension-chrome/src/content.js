// Content script. Runs in the isolated world on every matching host. Its job:
//
//   1. Figure out which adapter to use based on the hostname.
//   2. Expose a `window.postMessage`-style RPC the popup can drive via
//      `chrome.tabs.sendMessage`.
//   3. Inject the page-bridge script into the page's own world so we can
//      read `window.monaco.editor.getModels()` and friends.

import { base44Adapter } from '@unvibe/extractor-adapter-base44';
import { boltAdapter } from '@unvibe/extractor-adapter-bolt';
import { lovableAdapter } from '@unvibe/extractor-adapter-lovable';
import { extractProject, fileMapToZip } from '@unvibe/extractor-core';
import { pickAdapter } from '@unvibe/extractor-core/platform';

const ADAPTERS = [base44Adapter, boltAdapter, lovableAdapter];

injectPageBridge();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'UNVIBE_DETECT_PLATFORM') {
    const adapter = pickAdapter(ADAPTERS, location.hostname);
    sendResponse({
      platform: adapter?.platformName ?? null,
      hostname: location.hostname,
      hasTree: !!(adapter && adapter.getTreeScrollContainer()),
    });
    return false;
  }
  if (msg?.type === 'UNVIBE_EXTRACT') {
    const adapter = pickAdapter(ADAPTERS, location.hostname);
    if (!adapter) {
      sendResponse({ ok: false, error: `No adapter matches ${location.hostname}.` });
      return false;
    }
    runExtraction(adapter).then((result) => sendResponse(result));
    return true; // async
  }
  return false;
});

async function runExtraction(adapter) {
  try {
    const { files, warnings, platform, projectName } = await extractProject(adapter, {
      onProgress: (p) => chrome.runtime.sendMessage({ type: 'UNVIBE_PROGRESS', progress: p }),
    });
    const blob = await fileMapToZip(files, {
      rootFolder: projectName ? slugify(projectName) : 'project',
    });
    const dataUrl = await blobToDataURL(blob);
    return {
      ok: true,
      platform,
      projectName,
      fileCount: Object.keys(files).length,
      warnings,
      dataUrl,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'project';
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

function injectPageBridge() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-bridge.js');
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
  } catch (err) {
    console.warn('[unvibe] failed to inject page bridge', err);
  }
}
