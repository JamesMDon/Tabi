// Draws Tabi's logo, three #0af round-capped bars narrowing toward the bottom (jmd.me's stroke & paths, framed to
// fill the icon), & the done/warn/fail glyphs the toolbar icon briefly morphs into. Writes icons/Tabi.svg plus the
// PNGs, rendered by headless Brave so they match the SVG exactly.
// npm run icons (PLAYWRIGHT_CORE & BRAVE override the default paths)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(
  process.env.PLAYWRIGHT_CORE ?? "C:/Omni/Dev/Fixi/package.json",
);
const { chromium } = require("playwright-core");
const BRAVE =
  process.env.BRAVE ??
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const OUT = fileURLToPath(new URL("../icons/", import.meta.url));

// The bars span x 3 to 21 of the 24 grid, so a 2 2 20 20 frame leaves a 1-unit margin.
// The bars need no fill or join; the bent glyphs do.
const svg = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20"><path${/[lv]/.test(d) ? ' fill="none" stroke-linejoin="round"' : ""} stroke="#0af" stroke-linecap="round" stroke-width="2" d="${d}"/></svg>`;
const ICONS = [
  { name: "Tabi", d: "M4 7h16m-13 5h10m-6 5h2", sizes: [16, 32, 48, 128] },
  { name: "done", d: "M4 12.5l5 5 11-11", sizes: [16, 32] },
  { name: "warn", d: "M12 5v9m0 5h0", sizes: [16, 32] },
  { name: "fail", d: "M5 5l14 14m0-14L5 19", sizes: [16, 32] },
];

writeFileSync(`${OUT}Tabi.svg`, `${svg(ICONS[0].d)}\n`);
const browser = await chromium.launch({ executablePath: BRAVE, headless: true });
try {
  for (const { name, d, sizes } of ICONS) {
    for (const size of sizes) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
      });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(d)}`,
      );
      await page.screenshot({
        path: `${OUT}${name}${size}.png`,
        omitBackground: true,
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}
