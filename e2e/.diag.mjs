import { chromium } from "@playwright/test";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.goto("http://localhost:3100/search?service=lawn-mowing&postal=B3H%201A1", {
  timeout: 180000,
});
const measure = (label) =>
  page.evaluate((label) => {
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName}.${(el.className || "").toString().slice(0, 50)} right=${Math.round(el.getBoundingClientRect().right)}`,
      );
    return `${label}: scrollW=${document.documentElement.scrollWidth} scrollX=${scrollX} vvLeft=${visualViewport.offsetLeft} vvW=${visualViewport.width} scale=${visualViewport.scale} wide=${JSON.stringify(wide)}`;
  }, label);
console.log(await measure("loaded"));
const boxes = page.getByRole("checkbox", { name: /for a quote/ });
await boxes.nth(0).check();
console.log(await measure("one"));
await boxes.nth(1).check();
console.log(await measure("two"));
await page.waitForTimeout(1000);
console.log(await measure("later"));
await browser.close();
