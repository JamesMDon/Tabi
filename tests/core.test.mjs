import test from "node:test";
import assert from "node:assert/strict";

import {
  compareTabsByUrl,
  createDedupPlan,
  getTabUrl,
} from "../src/core.js";

function tab(overrides) {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    active: false,
    pinned: false,
    lastAccessed: 0,
    url: "https://example.com/",
    ...overrides,
  };
}

test("uses pendingUrl when a loading tab has no committed URL", () => {
  assert.equal(
    getTabUrl(tab({ url: "", pendingUrl: "https://example.com/loading" })),
    "https://example.com/loading",
  );
});

test("never treats tabs with unavailable URLs as duplicates", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 1, url: "", pendingUrl: "" }),
      tab({ id: 2, url: "", pendingUrl: "" }),
    ],
    10,
  );

  assert.deepEqual(plan.duplicateIds, []);
});

test("keeps a tab navigating away from a duplicate committed URL", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 1, active: true }),
      tab({ id: 2, pendingUrl: "https://example.com/next" }),
    ],
    10,
  );

  assert.deepEqual(plan.duplicateIds, []);
});

test("sorts a navigating tab by its destination", () => {
  const tabs = [
    tab({ id: 1, url: "https://example.com/a", pendingUrl: "https://example.com/z" }),
    tab({ id: 2, url: "https://example.com/b" }),
  ];

  tabs.sort(compareTabsByUrl);
  assert.deepEqual(tabs.map((candidate) => candidate.id), [2, 1]);
});

test("keeps the active target-window tab when duplicate URLs collide", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 1, windowId: 10, active: true }),
      tab({ id: 2, windowId: 20, audible: true, pinned: true }),
    ],
    10,
  );

  assert.deepEqual(plan.duplicateIds, [2]);
  assert.deepEqual(plan.survivorIds, [1]);
  assert.deepEqual(plan.pinIds, [1]);
});

test("keeps an audible duplicate ahead of silent inactive copies", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 3, windowId: 10, pinned: true }),
      tab({ id: 4, windowId: 20, audible: true }),
    ],
    10,
  );

  assert.deepEqual(plan.duplicateIds, [3]);
  assert.deepEqual(plan.survivorIds, [4]);
  assert.deepEqual(plan.pinIds, [4]);
});

test("keeps a target-window tab ahead of an imported pinned duplicate", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 3, windowId: 10 }),
      tab({ id: 4, windowId: 20, pinned: true }),
    ],
    10,
  );

  assert.deepEqual(plan.duplicateIds, [4]);
  assert.deepEqual(plan.pinIds, [3]);
});

test("sorts web pages by site, ignoring scheme & www, before browser pages", () => {
  const tabs = [
    tab({ id: 1, url: "brave://settings/" }),
    tab({ id: 2, url: "https://www.zeta.example/" }),
    tab({ id: 3, url: "https://beta.example/b" }),
    tab({ id: 4, url: "http://beta.example/a" }),
    tab({ id: 5, url: "https://alpha.example/" }),
  ];

  tabs.sort(compareTabsByUrl);
  assert.deepEqual(tabs.map((candidate) => candidate.id), [5, 4, 3, 2, 1]);
});

test("keeps a movable normal-window duplicate ahead of a popup copy", () => {
  const plan = createDedupPlan(
    [
      tab({ id: 3, windowId: 20 }),
      tab({ id: 4, windowId: 30, windowType: "popup", active: true }),
    ],
    10,
  );

  assert.deepEqual(plan.survivorIds, [3]);
  assert.deepEqual(plan.duplicateIds, [4]);
});

test("sorts consistently using committed and pending URLs", () => {
  const tabs = [
    tab({ id: 8, url: "", pendingUrl: "https://example.com/b" }),
    tab({ id: 7, url: "https://example.com/a" }),
  ];

  tabs.sort(compareTabsByUrl);
  assert.deepEqual(
    tabs.map((candidate) => candidate.id),
    [7, 8],
  );
});
