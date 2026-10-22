import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
);
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("uses a current Manifest V3 module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.background, {
    service_worker: "src/background.js",
    type: "module",
  });
});

test("keeps permissions narrow", () => {
  assert.deepEqual(manifest.permissions, ["tabs"]);
  assert.equal("optional_permissions" in manifest, false);
  assert.equal("host_permissions" in manifest, false);
});

test("runs directly from the toolbar action", () => {
  assert.equal("default_popup" in manifest.action, false);
});

test("keeps package and manifest versions aligned", () => {
  assert.equal(packageMetadata.version, manifest.version);
});

test("keeps store metadata concise", () => {
  assert.ok(manifest.name.length <= 45);
  assert.ok(manifest.description.length <= 132);
});

test("ships every icon at its declared size", async () => {
  const icons = [
    ...Object.entries(manifest.icons),
    ...Object.entries(manifest.action.default_icon),
    ...["done", "warn", "fail"].flatMap((name) =>
      [16, 32].map((size) => [size, `icons/${name}${size}.png`]),
    ),
  ];
  for (const [size, path] of icons) {
    const png = await readFile(new URL(`../${path}`, import.meta.url));
    assert.equal(png.toString("latin1", 12, 16), "IHDR", path);
    assert.equal(png.readUInt32BE(16), Number(size), path);
    assert.equal(png.readUInt32BE(20), Number(size), path);
  }
});

test("draws the logo in a single brand color", async () => {
  const svg = await readFile(
    new URL("../icons/Tabi.svg", import.meta.url),
    "utf8",
  );
  assert.deepEqual(
    [...new Set(svg.match(/#[0-9a-f]{3,6}\b/gi))],
    ["#0af"],
  );
});

test("ships without development metadata", () => {
  assert.equal("version_name" in manifest, false);
});

test("ships without development commands", () => {
  assert.equal("create_test_mess" in manifest.commands, false);
});
