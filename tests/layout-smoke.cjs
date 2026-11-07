"use strict";
/* Optional live js-dos layout smoke test.
 * Requires a running local HTTP server and a Playwright + Chromium installation.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const sizes = [[1920, 1080], [1366, 768], [360, 740]];

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_BINARY || undefined,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const base = process.env.TURBOC_TEST_URL || "http://127.0.0.1:8769/";
  try {
    for (const [width,height] of sizes) {
      const page = await browser.newPage({ viewport: {width,height} });
      const errors = [];
      page.on("pageerror",e=>errors.push(e.message));
      try {
        await page.goto(base,{waitUntil:"domcontentloaded"});
        assert.equal(await page.locator("#app").getAttribute("data-state"),"idle");
        await page.locator("#startBtn").click();
        await page.waitForFunction(()=>document.querySelector("#app").dataset.state==="running",{timeout:30000});
        const result = await page.evaluate(() => {
          const rect = node => {
            const r = node.getBoundingClientRect();
            return {x:r.x,y:r.y,width:r.width,height:r.height};
          };
          const screen=rect(document.querySelector("#screenArea"));
          const canvas=rect(document.querySelector("#dos-container canvas"));
          const monitor=rect(document.querySelector("#monitor"));
          return {
            viewport:{width:innerWidth,height:innerHeight},
            bodyHeight:document.documentElement.scrollHeight,
            bodyWidth:document.documentElement.scrollWidth,
            screen,canvas,monitor,
            background:getComputedStyle(document.body).backgroundColor,
          };
        });
        assert(result.bodyHeight<=height && result.bodyWidth<=width,
          "No page scrolling while running");
        assert(Math.abs(result.screen.width-result.canvas.width)<=1.5
          && Math.abs(result.screen.height-result.canvas.height)<=1.5,
          "Canvas must fit screen area without js-dos sidebar strips");
        assert(Math.abs(result.screen.x-result.canvas.x)<=1.5
          && Math.abs(result.screen.y-result.canvas.y)<=1.5,
          "Canvas must align with stage");
        assert(Math.abs(result.screen.width/result.screen.height-4/3)<.015,
          "DOS display should be 4:3");
        assert(result.background!=="rgb(255, 255, 255)",
          "js-dos stylesheet must not override host background");
        await page.locator("#scaleBtn").click();
        assert.equal(await page.locator("#scaleBtn").getAttribute("aria-pressed"),"true");
        assert.deepEqual(errors,[]);
        console.log("PASS viewport",width+"x"+height,"canvas",Math.round(result.canvas.width)+"x"+Math.round(result.canvas.height));
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
