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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function createSummary(mergedWindows, removedDuplicates, unresolvedPopups) {
  const parts = [];
  if (mergedWindows) {
    parts.push(`merged ${plural(mergedWindows, "window")}`);
  }
  if (removedDuplicates) {
    parts.push(`removed ${plural(removedDuplicates, "duplicate")}`);
  }
  if (unresolvedPopups) {
    parts.push(`left ${plural(unresolvedPopups, "popup tab")}`);
  }
  return parts.length ? parts.join(", ") : "no changes";
}

async function setFeedback(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}

function clearFeedbackAfter(milliseconds) {
  const timer = setTimeout(async () => {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Tabi" });
  }, milliseconds);
  timer?.unref?.();
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

async function getScopedWindows(incognito) {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal", "popup"],
  });
  return windows.filter((window) => window.incognito === incognito);
}

function getWindowTabs(windows) {
  return windows.flatMap((window) =>
    (window.tabs || []).map((tab) => ({
      ...tab,
      windowType: window.type,
    })),
  );
}

function canReopenPopupUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function moveSourceTab(tab, targetWindowId) {
  let unpinned = false;
  if (tab.pinned) {
    await chrome.tabs.update(tab.id, { pinned: false });
    unpinned = true;
  }

  try {
    await moveTabs([tab.id], { windowId: targetWindowId, index: -1 });
    return {};
  } catch (moveError) {
    if (tab.windowType !== "popup") {
      if (unpinned) await chrome.tabs.update(tab.id, { pinned: true });
      throw moveError;
    }

    const url = getTabUrl(tab);
    if (!canReopenPopupUrl(url)) {
      if (unpinned) await chrome.tabs.update(tab.id, { pinned: true });
      return { unresolved: true };
    }

    let replacement;
    try {
      replacement = await chrome.tabs.create({
        active: false,
        url,
        windowId: targetWindowId,
      });
      await chrome.tabs.remove(tab.id);
      return { replacementId: replacement.id };
    } catch (fallbackError) {
      if (replacement?.id) {
        await chrome.tabs.remove(replacement.id).catch(() => {});
      }
      if (unpinned) {
        await chrome.tabs.update(tab.id, { pinned: true }).catch(() => {});
      }
      console.warn("Tabi could not merge a popup tab:", fallbackError);
      return { unresolved: true };
    }
  }
}

async function tidyTabs(targetWindowId) {
  await setFeedback("…", "#888", "Tabi is tidying tabs");

  const targetWindow = await chrome.windows.get(targetWindowId);
  if (targetWindow.type !== "normal") {
    throw new Error("Run Tabi from a normal browser window.");
  }

  let scopedWindows = await getScopedWindows(targetWindow.incognito);
  const initialWindowCount = scopedWindows.length;
  let tabs = getWindowTabs(scopedWindows);
  const activeTabId = tabs.find(
    (tab) => tab.windowId === targetWindowId && tab.active,
  )?.id;

  const groupedIds = tabs
    .filter((tab) => tab.groupId !== NO_GROUP_ID)
    .map((tab) => tab.id);
  if (groupedIds.length) await chrome.tabs.ungroup(groupedIds);

  scopedWindows = await getScopedWindows(targetWindow.incognito);
  tabs = getWindowTabs(scopedWindows);
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

  scopedWindows = await getScopedWindows(targetWindow.incognito);
  tabs = getWindowTabs(scopedWindows);
  const sourceTabs = tabs
    .filter((tab) => tab.windowId !== targetWindowId)
    .sort(
      (left, right) =>
        left.windowId - right.windowId || left.index - right.index,
    );

  let unresolvedPopupTabs = 0;
  for (const tab of sourceTabs) {
    const result = await moveSourceTab(tab, targetWindowId);
    if (result.unresolved) unresolvedPopupTabs += 1;
    if (result.replacementId && pinnedIds.delete(tab.id)) {
      pinnedIds.add(result.replacementId);
    }
  }

  tabs = await chrome.tabs.query({ windowId: targetWindowId });
  for (const tab of tabs) {
    const shouldBePinned = pinnedIds.has(tab.id);
    if (tab.pinned !== shouldBePinned) {
      await chrome.tabs.update(tab.id, { pinned: shouldBePinned });
    }
  }

  tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const pinned = tabs.filter((tab) => tab.pinned).sort(compareTabsByUrl);
  const unpinned = tabs.filter((tab) => !tab.pinned).sort(compareTabsByUrl);

  await moveTabs(
    pinned.map((tab) => tab.id),
    { windowId: targetWindowId, index: 0 },
  );
  await moveTabs(
    unpinned.map((tab) => tab.id),
    { windowId: targetWindowId, index: pinned.length },
  );

  if (activeTabId) {
    const activeTabExists = await chrome.tabs
      .get(activeTabId)
      .then(() => true)
      .catch(() => false);
    if (activeTabExists) await chrome.tabs.update(activeTabId, { active: true });
  }
  await chrome.windows.update(targetWindowId, { focused: true });

  const remainingWindows = await getScopedWindows(targetWindow.incognito);
  const mergedWindowCount = initialWindowCount - remainingWindows.length;
  const summary = createSummary(
    mergedWindowCount,
    plan.duplicateIds.length,
    unresolvedPopupTabs,
  );

  if (unresolvedPopupTabs) {
    await setFeedback("!", "#F59E0B", `Tabi: ${summary}`);
    clearFeedbackAfter(PROBLEM_DURATION_MS);
    return;
  }

  const badge = plan.duplicateIds.length
    ? `-${plan.duplicateIds.length}`
    : "✓";
  await setFeedback(badge, "#4CAF50", `Tabi: ${summary}`);
  clearFeedbackAfter(SUCCESS_DURATION_MS);
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
