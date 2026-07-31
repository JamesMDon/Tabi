import {
  compareTabsByUrl,
  createDedupPlan,
  getTabUrl,
} from "./core.js";

const NO_GROUP_ID = -1;
const MOVE_ATTEMPTS = 5;
const SUCCESS_DURATION_MS = 2000;
const PROBLEM_DURATION_MS = 5000;
let running = false;
let feedbackTimer;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function createSummary(removedDuplicates, unresolvedPopups) {
  const parts = [];
  if (removedDuplicates) {
    parts.push(`removed ${plural(removedDuplicates, "duplicate")}`);
  }
  if (unresolvedPopups) {
    parts.push(`left ${plural(unresolvedPopups, "popup tab")}`);
  }
  return parts.length ? parts.join(", ") : "done";
}

async function setFeedback(text, color, title) {
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = undefined;
  }
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title }),
  ]);
}

function clearFeedbackAfter(milliseconds) {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(async () => {
    feedbackTimer = undefined;
    await Promise.all([
      chrome.action.setBadgeText({ text: "" }),
      chrome.action.setTitle({ title: "Tabi" }),
    ]).catch(() => {});
  }, milliseconds);
  feedbackTimer?.unref?.();
}

async function moveTabs(tabIds, moveProperties) {
  if (!tabIds.length) return;

  for (let attempt = 1; attempt <= MOVE_ATTEMPTS; attempt += 1) {
    try {
      await chrome.tabs.move(tabIds, moveProperties);
      return;
    } catch (error) {
      const temporary = String(error).includes(
        "Tabs cannot be edited right now",
      );
      if (!temporary || attempt === MOVE_ATTEMPTS) throw error;
      await delay(50 * attempt);
    }
  }
}

async function getScopedWindows(incognito, windowIds) {
  const includedIds = windowIds ? new Set(windowIds) : null;
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal", "popup"],
  });
  return windows.filter(
    (window) =>
      window.incognito === incognito &&
      (!includedIds || includedIds.has(window.id)),
  );
}

function getWindowTabs(windows) {
  return windows.flatMap((window) =>
    (window.tabs || []).map((tab) => ({
      ...tab,
      windowType: window.type,
    })),
  );
}

function hasSameTabOrder(current, desired) {
  return (
    current.length === desired.length &&
    current.every((tab, index) => tab.id === desired[index].id)
  );
}

function canReopenPopupUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function reopenPopupTab(tab, targetWindowId) {
  const url = getTabUrl(tab);
  if (!canReopenPopupUrl(url)) return {};

  let replacement;
  try {
    replacement = await chrome.tabs.create({
      active: false,
      url,
      windowId: targetWindowId,
    });
    await chrome.tabs.remove(tab.id);
    return { replacementId: replacement.id };
  } catch (error) {
    if (replacement?.id) {
      await chrome.tabs.remove(replacement.id).catch(() => {});
    }
    console.warn("Tabi could not merge a popup tab:", error);
    return {};
  }
}

async function mergePopupTabs(popupTabs, targetWindowId, pinnedIds) {
  if (!popupTabs.length) return 0;

  try {
    await moveTabs(
      popupTabs.map((tab) => tab.id),
      { windowId: targetWindowId, index: -1 },
    );
    return 0;
  } catch {
    let unresolved = 0;

    for (const tab of popupTabs) {
      const currentTab = await chrome.tabs.get(tab.id).catch(() => null);
      if (!currentTab || currentTab.windowId === targetWindowId) continue;

      try {
        await moveTabs([tab.id], { windowId: targetWindowId, index: -1 });
        continue;
      } catch {
        const result = await reopenPopupTab(tab, targetWindowId);
        if (!result.replacementId) {
          unresolved += 1;
          continue;
        }
        if (pinnedIds.delete(tab.id)) {
          pinnedIds.add(result.replacementId);
        }
      }
    }

    return unresolved;
  }
}

export async function tidyTabs(
  targetWindowId,
  { showFeedback = true, windowIds } = {},
) {
  if (showFeedback) {
    await setFeedback("…", "#888", "Tabi is tidying tabs");
  }

  const targetWindow = await chrome.windows.get(targetWindowId);
  if (targetWindow.type !== "normal") {
    throw new Error("Run Tabi from a normal browser window.");
  }

  const scopedWindows = await getScopedWindows(
    targetWindow.incognito,
    windowIds,
  );
  let tabs = getWindowTabs(scopedWindows);
  const activeTabId = tabs.find(
    (tab) => tab.windowId === targetWindowId && tab.active,
  )?.id;
  const plan = createDedupPlan(tabs, targetWindowId);
  const duplicateIds = new Set(plan.duplicateIds);
  const pinnedIds = new Set([
    ...tabs
      .filter((tab) => tab.pinned && !duplicateIds.has(tab.id))
      .map((tab) => tab.id),
    ...plan.pinIds,
  ]);

  if (plan.duplicateIds.length) {
    await chrome.tabs.remove(plan.duplicateIds);
  }

  const groupedIds = tabs
    .filter(
      (tab) =>
        tab.groupId !== NO_GROUP_ID && !duplicateIds.has(tab.id),
    )
    .map((tab) => tab.id);
  if (groupedIds.length) await chrome.tabs.ungroup(groupedIds);

  const sourceTabs = tabs
    .filter(
      (tab) =>
        tab.windowId !== targetWindowId && !duplicateIds.has(tab.id),
    )
    .sort(
      (left, right) =>
        left.windowId - right.windowId || left.index - right.index,
    );
  const normalTabIds = sourceTabs
    .filter((tab) => tab.windowType === "normal")
    .map((tab) => tab.id);
  const popupTabs = sourceTabs.filter((tab) => tab.windowType === "popup");

  await moveTabs(normalTabIds, { windowId: targetWindowId, index: -1 });
  const unresolvedPopupTabs = await mergePopupTabs(
    popupTabs,
    targetWindowId,
    pinnedIds,
  );

  tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const tabsToPin = tabs.filter(
    (tab) => pinnedIds.has(tab.id) && !tab.pinned,
  );
  if (tabsToPin.length) {
    await Promise.all(
      tabsToPin.map(async (tab) => {
        await chrome.tabs.update(tab.id, { pinned: true });
        tab.pinned = true;
      }),
    );
  }

  const pinned = tabs.filter((tab) => tab.pinned).sort(compareTabsByUrl);
  const unpinned = tabs.filter((tab) => !tab.pinned).sort(compareTabsByUrl);
  const currentPinned = tabs.filter((tab) => tab.pinned);
  const currentUnpinned = tabs.filter((tab) => !tab.pinned);
  const pinStateChanged = tabsToPin.length > 0;

  if (pinStateChanged || !hasSameTabOrder(currentPinned, pinned)) {
    await moveTabs(
      pinned.map((tab) => tab.id),
      { windowId: targetWindowId, index: 0 },
    );
  }
  if (pinStateChanged || !hasSameTabOrder(currentUnpinned, unpinned)) {
    await moveTabs(
      unpinned.map((tab) => tab.id),
      { windowId: targetWindowId, index: pinned.length },
    );
  }

  const activeTabStillActive = tabs.some(
    (tab) => tab.id === activeTabId && tab.active,
  );
  if (activeTabId && !activeTabStillActive) {
    await chrome.tabs
      .update(activeTabId, { active: true })
      .catch(() => {});
  }
  const summary = createSummary(
    plan.duplicateIds.length,
    unresolvedPopupTabs,
  );

  if (unresolvedPopupTabs) {
    if (showFeedback) {
      await setFeedback("!", "#F59E0B", `Tabi: ${summary}`);
      clearFeedbackAfter(PROBLEM_DURATION_MS);
    }
    return {
      removedDuplicates: plan.duplicateIds.length,
      unresolvedPopupTabs,
    };
  }

  const badge = plan.duplicateIds.length
    ? `-${plan.duplicateIds.length}`
    : "✓";
  if (showFeedback) {
    await setFeedback(badge, "#4CAF50", `Tabi: ${summary}`);
    clearFeedbackAfter(SUCCESS_DURATION_MS);
  }
  return {
    removedDuplicates: plan.duplicateIds.length,
    unresolvedPopupTabs,
  };
}

chrome.action.onClicked.addListener(async (tab) => {
  if (running || !tab.windowId) return;
  running = true;

  try {
    await tidyTabs(tab.windowId);
  } catch (error) {
    console.error("Tabi:", error);
    const message = error instanceof Error ? error.message : String(error);
    await setFeedback("×", "#F44336", `Tabi failed: ${message}`);
    clearFeedbackAfter(PROBLEM_DURATION_MS);
  } finally {
    running = false;
  }
});
