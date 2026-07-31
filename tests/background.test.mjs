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
  captureTimers = false,
  initialTabs,
  initialWindows,
  rejectPopupMoves = false,
  temporaryMoveFailures = 0,
}) {
  let badge = "";
  let clickListener;
  let title = "Tabi";
  let nextTabId = 100;
  const moveCalls = [];
  const calls = {
    tabGet: 0,
    tabQuery: 0,
    tabUpdate: 0,
    windowGet: 0,
    windowGetAll: 0,
    windowUpdate: 0,
  };
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  if (captureTimers) {
    globalThis.setTimeout = (callback, milliseconds) => {
      const timer = {
        callback,
        cancelled: false,
        milliseconds,
        unref() {},
      };
      scheduledTimers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = (timer) => {
      timer.cancelled = true;
    };
  }
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
    runtime: {
      getManifest() {
        return { permissions: ["tabs"] };
      },
    },
    windows: {
      async get(windowId) {
        calls.windowGet += 1;
        return windows.get(windowId);
      },
      async getAll({ windowTypes }) {
        calls.windowGetAll += 1;
        return [...windows.values()]
          .filter((window) => windowTypes.includes(window.type))
          .map((window) => ({
            ...window,
            tabs: tabs
              .filter((tab) => tab.windowId === window.id)
              .sort((left, right) => left.index - right.index),
          }));
      },
      async update() {
        calls.windowUpdate += 1;
      },
    },
    tabs: {
      async query(query) {
        calls.tabQuery += 1;
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
        calls.tabUpdate += 1;
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
        moveCalls.push({ ids: [...ids], windowId, index });
        if (temporaryMoveFailures > 0) {
          temporaryMoveFailures -= 1;
          throw new Error("Tabs cannot be edited right now");
        }
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
        calls.tabGet += 1;
        const tab = tabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error("Tab not found");
        return tab;
      },
    },
  };

  const background = await import(
    `../src/background.js?test=${Math.random()}`
  );
  assert.equal(typeof clickListener, "function");

  return {
    cleanup() {
      if (captureTimers) {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
      }
    },
    click: async (tabId) => {
      await clickListener(tabs.find((tab) => tab.id === tabId));
    },
    get badge() {
      return badge;
    },
    get calls() {
      return calls;
    },
    get moveCalls() {
      return moveCalls;
    },
    get scheduledTimers() {
      return scheduledTimers;
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
    tidy: background.tidyTabs,
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
    "Tabi: removed 1 duplicate",
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
    "Tabi: done",
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

test("moves ordinary source tabs in one batch", async () => {
  const harness = await createHarness({
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 20, type: "normal", incognito: false },
      { id: 30, type: "normal", incognito: false },
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
        windowId: 20,
        url: "https://example.com/b",
      }),
      makeTab({
        id: 3,
        windowId: 20,
        index: 1,
        url: "https://example.com/c",
      }),
      makeTab({
        id: 4,
        windowId: 30,
        url: "https://example.com/d",
      }),
      makeTab({
        id: 5,
        windowId: 30,
        index: 1,
        url: "https://example.com/e",
      }),
    ],
  });

  await harness.click(1);

  const mergeCalls = harness.moveCalls.filter((call) => call.index === -1);
  assert.deepEqual(mergeCalls, [
    { ids: [2, 3, 4, 5], windowId: 10, index: -1 },
  ]);
  assert.deepEqual(harness.calls, {
    tabGet: 0,
    tabQuery: 1,
    tabUpdate: 0,
    windowGet: 1,
    windowGetAll: 1,
    windowUpdate: 0,
  });
});

test("skips tab moves and active updates when the target is already tidy", async () => {
  const harness = await createHarness({
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
    ],
    initialTabs: [
      makeTab({
        id: 1,
        windowId: 10,
        active: true,
        pinned: true,
        url: "https://example.com/a",
      }),
      makeTab({
        id: 2,
        windowId: 10,
        index: 1,
        url: "https://example.com/b",
      }),
    ],
  });

  await harness.click(1);

  assert.deepEqual(harness.moveCalls, []);
  assert.equal(harness.calls.tabUpdate, 0);
  assert.equal(harness.badge, "✓");
});

test("retries a temporary Brave tab edit lock", async () => {
  const harness = await createHarness({
    temporaryMoveFailures: 1,
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 20, type: "normal", incognito: false },
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
        windowId: 20,
        active: true,
        url: "https://example.com/b",
      }),
    ],
  });

  await harness.click(1);

  assert.equal(
    harness.tabs.find((tab) => tab.id === 2)?.windowId,
    10,
  );
  assert.equal(
    harness.moveCalls.filter((call) => call.index === -1).length,
    2,
  );
  assert.equal(harness.badge, "✓");
});

test("cancels an older feedback timer when Tabi runs again", async () => {
  const harness = await createHarness({
    captureTimers: true,
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
    ],
    initialTabs: [
      makeTab({
        id: 1,
        windowId: 10,
        active: true,
      }),
    ],
  });

  try {
    await harness.click(1);
    await harness.click(1);

    assert.equal(harness.scheduledTimers.length, 2);
    assert.equal(harness.scheduledTimers[0].cancelled, true);
    assert.equal(harness.scheduledTimers[1].cancelled, false);

    await harness.scheduledTimers[1].callback();
    assert.equal(harness.badge, "");
    assert.equal(harness.title, "Tabi");
  } finally {
    harness.cleanup();
  }
});

test("preserves a popup pin when fallback reopening is required", async () => {
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
        pinned: true,
        url: "https://example.com/a",
      }),
    ],
  });

  await harness.click(1);

  const replacement = harness.tabs.find(
    (tab) => tab.url === "https://example.com/a",
  );
  assert.equal(replacement?.windowId, 10);
  assert.equal(replacement?.pinned, true);
  assert.equal(harness.tabs.some((tab) => tab.id === 6), false);
});

test("scoped tidy ignores every window outside its explicit fixture", async () => {
  const harness = await createHarness({
    initialWindows: [
      { id: 10, type: "normal", incognito: false },
      { id: 20, type: "normal", incognito: false },
      { id: 30, type: "normal", incognito: false },
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
        windowId: 20,
        active: true,
        url: "https://example.com/b",
      }),
      makeTab({
        id: 3,
        windowId: 30,
        active: true,
        url: "https://user.example/private",
      }),
    ],
  });

  await harness.tidy(10, {
    showFeedback: false,
    windowIds: [10, 20],
  });

  assert.equal(harness.tabs.find((tab) => tab.id === 2)?.windowId, 10);
  assert.deepEqual(
    harness.tabs
      .filter((tab) => tab.windowId === 30)
      .map((tab) => tab.url),
    ["https://user.example/private"],
  );
  assert.equal(harness.windows.has(30), true);
});
