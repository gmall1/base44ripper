// Popup controller.

const subtitle = document.getElementById('subtitle');
const extractBtn = document.getElementById('extract');
const tip = document.getElementById('tip');
const status = document.getElementById('status');
const result = document.getElementById('result');

let activeTabId = null;
let detectedPlatform = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (!tab?.url) {
    subtitle.textContent = 'Open a Base44, Lovable, or Bolt project tab first.';
    return;
  }
  try {
    const info = await chrome.tabs.sendMessage(tab.id, { type: 'UNVIBE_DETECT_PLATFORM' });
    if (info?.platform) {
      detectedPlatform = info.platform;
      subtitle.textContent = `${info.platform} project detected on ${info.hostname}.`;
      extractBtn.disabled = false;
      if (!info.hasTree) {
        tip.classList.remove('hidden');
      }
    } else {
      subtitle.textContent = `No supported editor detected on ${info?.hostname ?? 'this page'}.`;
    }
  } catch (err) {
    subtitle.textContent = 'Content script not loaded — reload the page and try again.';
    console.warn(err);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'UNVIBE_PROGRESS') {
    status.classList.remove('hidden');
    const p = msg.progress;
    if (p.phase === 'scanning-tree') {
      status.textContent = `Scanning file tree… ${p.filesSeen ?? 0} files seen`;
    } else if (p.phase === 'reading-files') {
      status.textContent = `Reading ${p.filesRead ?? 0} / ${p.total ?? '?'} — ${p.currentPath ?? ''}`;
    } else if (p.phase === 'zipping') {
      status.textContent = 'Packaging zip…';
    } else if (p.phase === 'done') {
      status.textContent = `Done — ${p.filesRead ?? 0} files`;
    }
  }
});

extractBtn.addEventListener('click', async () => {
  if (activeTabId == null) return;
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting…';
  result.classList.add('hidden');
  result.classList.remove('error');
  try {
    const r = await chrome.tabs.sendMessage(activeTabId, { type: 'UNVIBE_EXTRACT' });
    if (!r?.ok) {
      result.classList.remove('hidden');
      result.classList.add('error');
      result.textContent = r?.error ?? 'Extraction failed.';
      return;
    }
    const filename = `${r.projectName ? slugify(r.projectName) : 'project'}-unvibe.zip`;
    await chrome.runtime.sendMessage({
      type: 'UNVIBE_DOWNLOAD_ZIP',
      dataUrl: r.dataUrl,
      filename,
    });
    result.classList.remove('hidden');
    result.innerHTML = `<strong>Saved ${filename}</strong><br>${r.fileCount} files from ${r.platform}.`;
    if (r.warnings?.length) {
      for (const w of r.warnings) {
        const el = document.createElement('div');
        el.className = 'warn';
        el.textContent = `⚠ ${w}`;
        result.appendChild(el);
      }
    }
  } catch (err) {
    result.classList.remove('hidden');
    result.classList.add('error');
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    extractBtn.textContent = 'Extract project';
    extractBtn.disabled = !detectedPlatform;
  }
});

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'project';
}
