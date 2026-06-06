// Open the translator in the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    // Fallback: open the full app in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
  }
});
