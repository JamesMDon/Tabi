// Draws Tabi's logo, three #0af round-capped bars narrowing toward the bottom, & writes icons/Tabi.svg plus the
// manifest's PNGs, rendered by headless Brave so they match the SVG exactly.
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
const SIZES = [16, 32, 48, 128];

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke="#0af" stroke-linecap="round" stroke-width="3" d="M4 7h16m-13 5h10m-6 5h2"/></svg>';

writeFileSync(`${OUT}Tabi.svg`, `${svg}\n`);
const browser = await chromium.launch({ executablePath: BRAVE, headless: true });
try {
  for (const size of SIZES) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
    });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({
      path: `${OUT}Tabi${size}.png`,
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
