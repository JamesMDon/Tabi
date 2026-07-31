export function getTabUrl(tab) {
  return tab.url || tab.pendingUrl || "";
}

export function compareTabsByUrl(left, right) {
  const urlComparison = getTabUrl(left).localeCompare(getTabUrl(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (urlComparison !== 0) return urlComparison;
  return left.id - right.id;
}

function survivorPriority(tab, targetWindowId) {
  return [
    Number(tab.windowId === targetWindowId && tab.active),
    Number(Boolean(tab.audible)),
    Number(tab.windowId === targetWindowId),
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
