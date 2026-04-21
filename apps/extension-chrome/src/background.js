// MV3 service worker.
//
// We keep the background script thin: the popup is where the user triggers
// extraction, and the content script does the actual work. This file only
// exists so the popup can ping the active tab and so `chrome.downloads` can
// be invoked from an extension context (content scripts can't call it
// directly without `scripting.executeScript` hacks).

chrome.runtime.onInstalled.addListener(() => {
  console.log('[unvibe] extension installed');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'UNVIBE_DOWNLOAD_ZIP') {
    // Popup built a Blob, turned it into a data URL, and asked us to save it.
    chrome.downloads.download(
      {
        url: msg.dataUrl,
        filename: msg.filename ?? 'unvibe-export.zip',
        saveAs: true,
      },
      (downloadId) => sendResponse({ downloadId, error: chrome.runtime.lastError?.message ?? null }),
    );
    return true; // async
  }
  return false;
});
