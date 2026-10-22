export function getTabUrl(tab) {
  return tab.pendingUrl || tab.url || "";
}

// Web pages sort by site, ignoring the scheme & a leading "www.", so http &
// https copies of a site sit together; browser & extension pages follow.
function getSortKey(tab) {
  const url = getTabUrl(tab);
  try {
    const { protocol, host, pathname, search, hash } = new URL(url);
    if (protocol === "http:" || protocol === "https:") {
      return [0, `${host.replace(/^www\./, "")}${pathname}${search}${hash}`];
    }
  } catch {}
  return [1, url];
}

function compareText(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function compareTabsByUrl(left, right) {
  const [leftRank, leftKey] = getSortKey(left);
  const [rightRank, rightKey] = getSortKey(right);
  return (
    leftRank - rightRank ||
    compareText(leftKey, rightKey) ||
    compareText(getTabUrl(left), getTabUrl(right)) ||
    left.id - right.id
  );
}

function survivorPriority(tab, targetWindowId) {
  return [
    Number(tab.windowId === targetWindowId && tab.active),
    Number(Boolean(tab.audible)),
    Number(tab.windowId === targetWindowId),
    // A popup survivor may have to be reopened, losing its page state.
    Number(tab.windowType !== "popup"),
    Number(tab.pinned),
    Number(tab.active),
    Number(tab.lastAccessed || 0),
    -Number(tab.index || 0),
  ];
}

function comparePriorities(left, right, targetWindowId) {
  const leftPriority = survivorPriority(left, targetWindowId);
  const rightPriority = survivorPriority(right, targetWindowId);

  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) {
      return rightPriority[index] - leftPriority[index];
    }
  }

  return left.id - right.id;
}

export function createDedupPlan(tabs, targetWindowId) {
  const byUrl = new Map();

  for (const tab of tabs) {
    const url = getTabUrl(tab);
    if (!url) continue;
    const matches = byUrl.get(url) || [];
    matches.push(tab);
    byUrl.set(url, matches);
  }

  const duplicateIds = [];
  const pinIds = [];
  const survivorIds = [];

  for (const matches of byUrl.values()) {
    matches.sort((left, right) =>
      comparePriorities(left, right, targetWindowId),
    );
    const [survivor, ...duplicates] = matches;
    survivorIds.push(survivor.id);
    duplicateIds.push(...duplicates.map((tab) => tab.id));

    if (matches.some((tab) => tab.pinned) && !survivor.pinned) {
      pinIds.push(survivor.id);
    }
  }

  return {
    duplicateIds,
    pinIds,
    survivorIds,
  };
}
