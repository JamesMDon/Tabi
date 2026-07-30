import test from "node:test";
import assert from "node:assert/strict";

function makeTab(overrides) {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    active: false,
    audible: false,
    pinned: false,
    incognito: false,
    groupId: -1,
    url: "https://example.com/",
    ...overrides,
  };
}

async function createHarness({
  initialTabs,
  initialWindows,
  rejectPopupMoves = false,
}) {
  let badge = "";
  let clickListener;
  let title = "Tabi";
  let nextTabId = 100;
  const windows = new Map(
    initialWindows.map((window) => [window.id, { ...window }]),
  );
  const tabs = initialTabs.map((tab) => ({ ...tab }));

  function reindex(windowId) {
    tabs
      .filter((tab) => tab.windowId === windowId)
      .sort((left, right) => left.index - right.index)
      .forEach((tab, index) => {
        tab.index = index;
      });
  }

  function removeEmptyWindows() {
    for (const windowId of windows.keys()) {
      if (!tabs.some((tab) => tab.windowId === windowId)) {
        windows.delete(windowId);
      }
    }
  }

  globalThis.chrome = {
    action: {
      onClicked: {
        addListener(listener) {
          clickListener = listener;
        },
      },
      async setBadgeText({ text }) {
        badge = text;
      },
      async setBadgeBackgroundColor() {},
      async setTitle({ title: nextTitle }) {
        title = nextTitle;
      },
    },
    windows: {
      async get(windowId) {
        return windows.get(windowId);
      },
      async getAll({ windowTypes }) {
        return [...windows.values()]
          .filter((window) => windowTypes.includes(window.type))
          .map((window) => ({
            ...window,
            tabs: tabs
              .filter((tab) => tab.windowId === window.id)
              .sort((left, right) => left.index - right.index),
          }));
      },
      async update() {},
    },
    tabs: {
      async query(query) {
        if (query.windowType) {
          return tabs.filter(
            (tab) => windows.get(tab.windowId)?.type === query.windowType,
          );
        }
        if (query.windowId) {
          return tabs.filter((tab) => tab.windowId === query.windowId);
        }
        return tabs;
      },
      async ungroup(tabIds) {
        for (const tab of tabs) {
          if (tabIds.includes(tab.id)) tab.groupId = -1;
        }
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const tabId of ids) {
          const index = tabs.findIndex((tab) => tab.id === tabId);
          if (index >= 0) tabs.splice(index, 1);
        }
        removeEmptyWindows();
      },
      async update(tabId, changes) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error("Tab not found");
        if (changes.active) {
          for (const candidate of tabs) {
            if (candidate.windowId === tab.windowId) candidate.active = false;
          }
        }
        Object.assign(tab, changes);
        return tab;
      },
      async move(tabIds, { windowId, index }) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const moving = ids.map((id) =>
          tabs.find((candidate) => candidate.id === id),
        );
        if (
          rejectPopupMoves &&
          moving.some(
            (tab) => windows.get(tab.windowId)?.type === "popup",
          )
        ) {
          throw new Error("Popup tabs cannot be moved to a normal window");
        }

        const oldWindows = new Set(moving.map((tab) => tab.windowId));
        const remaining = tabs
          .filter(
            (tab) => tab.windowId === windowId && !ids.includes(tab.id),
          )
          .sort((left, right) => left.index - right.index);
        const insertionIndex = index < 0 ? remaining.length : index;
        remaining.splice(insertionIndex, 0, ...moving);
        remaining.forEach((tab, tabIndex) => {
          tab.windowId = windowId;
          tab.index = tabIndex;
        });
        for (const oldWindowId of oldWindows) reindex(oldWindowId);
        removeEmptyWindows();
        return moving;
      },
      async create(properties) {
        const tab = makeTab({
          id: nextTabId,
          windowId: properties.windowId,
          index: tabs.filter(
            (candidate) => candidate.windowId === properties.windowId,
          ).length,
          active: properties.active,
          url: properties.url,
        });
        nextTabId += 1;
        tabs.push(tab);
        return tab;
      },
      async get(tabId) {
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error("Tab not found");
        return tab;
      },
    },
  };

  await import(`../src/background.js?test=${Math.random()}`);
  assert.equal(typeof clickListener, "function");

  return {
    click: async (tabId) => {
      await clickListener(tabs.find((tab) => tab.id === tabId));
    },
    get badge() {
      return badge;
    },
    get tabs() {
      return tabs;
    },
    get title() {
      return title;
    },
    get windows() {
      return windows;
    },
  };
}

test("one click merges normal and popup windows while preserving active pin state", async () => {
  const harness = await createHarness({
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 20, type: "normal", incognito: false },
      { id: 30, type: "normal", incognito: true },
      { id: 40, type: "popup", incognito: false },
    ],
    initialTabs: [
      makeTab({
        id: 1,
        windowId: 10,
        active: true,
        url: "https://example.com/a",
      }),
      makeTab({
        id: 2,
        windowId: 10,
        index: 1,
        url: "https://example.com/c",
      }),
      makeTab({
        id: 3,
        windowId: 20,
        active: true,
        audible: true,
        pinned: true,
        groupId: 7,
        url: "https://example.com/a",
      }),
      makeTab({
        id: 4,
        windowId: 20,
        index: 1,
        groupId: 7,
        url: "https://example.com/b",
      }),
      makeTab({
        id: 5,
        windowId: 30,
        incognito: true,
        active: true,
        url: "https://example.com/private",
      }),
      makeTab({
        id: 6,
        windowId: 40,
        active: true,
        url: "https://example.com/popup",
      }),
    ],
  });

  await harness.click(1);

  const targetTabs = harness.tabs
    .filter((tab) => tab.windowId === 10)
    .sort((left, right) => left.index - right.index);

  assert.deepEqual(
    targetTabs.map((tab) => tab.id),
    [1, 4, 2, 6],
  );
  assert.equal(targetTabs[0].active, true);
  assert.equal(targetTabs[0].pinned, true);
  assert.ok(targetTabs.every((tab) => tab.groupId === -1));
  assert.equal(harness.tabs.some((tab) => tab.id === 3), false);
  assert.equal(harness.tabs.find((tab) => tab.id === 5)?.windowId, 30);
  assert.equal(harness.windows.has(40), false);
  assert.equal(harness.badge, "-1");
  assert.equal(
    harness.title,
    "Tabi: merged 2 windows, removed 1 duplicate",
  );
});

test("reopens a popup URL when the browser rejects a live move", async () => {
  const harness = await createHarness({
    rejectPopupMoves: true,
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 40, type: "popup", incognito: false },
    ],
    initialTabs: [
      makeTab({
        id: 1,
        windowId: 10,
        active: true,
        url: "https://example.com/z",
      }),
      makeTab({
        id: 6,
        windowId: 40,
        active: true,
        url: "https://example.com/a",
      }),
    ],
  });

  await harness.click(1);

  assert.deepEqual(
    harness.tabs
      .filter((tab) => tab.windowId === 10)
      .sort((left, right) => left.index - right.index)
      .map((tab) => tab.url),
    ["https://example.com/a", "https://example.com/z"],
  );
  assert.equal(harness.tabs.some((tab) => tab.id === 6), false);
  assert.equal(harness.windows.has(40), false);
  assert.equal(harness.badge, "✓");
  assert.equal(
    harness.title,
    "Tabi: merged 1 window",
  );
});

test("leaves an unreopenable popup intact and shows a quiet warning", async () => {
  const harness = await createHarness({
    rejectPopupMoves: true,
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 40, type: "popup", incognito: false },
    ],
    initialTabs: [
      makeTab({
        id: 1,
        windowId: 10,
        active: true,
      }),
      makeTab({
        id: 6,
        windowId: 40,
        active: true,
        url: "chrome://settings/",
      }),
    ],
  });

  await harness.click(1);

  assert.equal(harness.tabs.find((tab) => tab.id === 6)?.windowId, 40);
  assert.equal(harness.windows.has(40), true);
  assert.equal(harness.badge, "!");
  assert.equal(
    harness.title,
    "Tabi: left 1 popup tab",
  );
});
