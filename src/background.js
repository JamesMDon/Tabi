async function processTabs(windowId) {
  await chrome.action.setBadgeText({ text: '...' });
  await chrome.action.setBadgeBackgroundColor({ color: '#888' });

  try {
    const currentWindow = await chrome.windows.get(windowId);
    
    // Step 1: Snapshot & Merge
    const allTabs = await chrome.tabs.query({});
    const originalPins = new Set();
    const mergeIds = [];

    for (const tab of allTabs) {
      if (tab.windowId !== windowId && tab.incognito === currentWindow.incognito) {
        mergeIds.push(tab.id);
        if (tab.pinned) originalPins.add(tab.id);
      }
    }

    if (mergeIds.length) {
      await chrome.tabs.move(mergeIds, { windowId, index: -1 });
    }

    // Step 2: Deduplicate
    const tabs = await chrome.tabs.query({ windowId });
    const isPinned = (t) => t.pinned || originalPins.has(t.id);
    
    // Sort: pins first (keeps pinned version of dupes)
    tabs.sort((a, b) => isPinned(b) - isPinned(a));

    const seen = new Set();
    const unique = [];
    const dupeIds = [];

    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl || '';
      if (seen.has(url)) {
        dupeIds.push(tab.id);
      } else {
        seen.add(url);
        unique.push(tab);
      }
    }

    if (dupeIds.length) await chrome.tabs.remove(dupeIds);

    // Step 3: Sort & Move
    const urlSort = (a, b) => (a.url || '').localeCompare(b.url || '');
    const pinned = unique.filter(isPinned).sort(urlSort);
    const unpinned = unique.filter(t => !isPinned(t)).sort(urlSort);

    const pinnedIds = pinned.map(t => t.id);
    const unpinnedIds = unpinned.map(t => t.id);

    if (pinnedIds.length) {
      await chrome.tabs.move(pinnedIds, { index: 0 });
      await Promise.all(
        pinned.filter(t => !t.pinned).map(t => chrome.tabs.update(t.id, { pinned: true }))
      );
    }

    if (unpinnedIds.length) {
      await chrome.tabs.move(unpinnedIds, { index: pinnedIds.length });
    }

    // Success: show dupe count or checkmark
    const badge = dupeIds.length ? `−${dupeIds.length}` : '✓';
    await chrome.action.setBadgeText({ text: badge });
    await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);

  } catch (err) {
    console.error('Tabi:', err);
    await chrome.action.setBadgeText({ text: 'ERR' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
  }
}

chrome.action.onClicked.addListener((tab) => processTabs(tab.windowId));

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === '_execute_action') {
    chrome.windows.getCurrent((w) => processTabs(w.id));
  }
});