"use strict";
/* Optional end-to-end test against real js-dos 8.5.3.
 * Requires a local HTTP server and Playwright/Chromium for tests only.
 */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fixture = path.join(__dirname, "fixtures", "advanced-test.zip");

async function main() {
  const browser=await chromium.launch({
    headless:true,
    executablePath:process.env.CHROMIUM_BINARY || undefined,
    args:["--no-sandbox","--enable-unsafe-swiftshader"]
  });
  const page=await browser.newPage({viewport:{width:1366,height:768},acceptDownloads:true});
  const errors=[], requests=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("request",request=>requests.push(request.url()));
  try {
    await page.goto(process.env.TURBOC_TEST_URL || "http://127.0.0.1:8769/");
    assert.equal(await page.locator("#app").getAttribute("data-mode"),"turbo");
    assert(!requests.some(url=>url.includes("/advanced.js")),
      "Turbo C must not load advanced mode by default");
    await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running",{timeout:30000});
    const modeNav=page.waitForEvent("framenavigated",{timeout:15000});
    await page.locator("#modeDos").click();
    await page.locator("#acceptConfirmBtn").click();
    await modeNav;
    await page.waitForFunction(()=>document.getElementById("app").dataset.mode==="dos",{timeout:15000});
    assert.equal(await page.locator("#app").getAttribute("data-mode"),"dos");
    await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running",
      {timeout:30000});
    assert.equal(await page.locator("#stateLabel").textContent(),"Running");
    await page.locator("#modeTurbo").click();
    assert.equal(await page.locator("#confirmPopover").isVisible(),true);
    await page.locator("#cancelConfirmBtn").click();
    assert.equal(await page.locator("#app").getAttribute("data-mode"),"dos");
    await page.locator("#downloadBtn").click();
    await page.setInputFiles("#advancedInput",{name:"broken.zip",mimeType:"application/zip",buffer:Buffer.from("not a ZIP")});
    await page.waitForFunction(()=>document.getElementById("advImportStatus").textContent.includes("ZIP central directory missing"));
    await page.setInputFiles("#advancedInput",{
      name:"advanced-test.zip",mimeType:"application/zip",buffer:fs.readFileSync(fixture)
    });
    await page.waitForFunction(()=>document.getElementById("advImportStatus").textContent.includes("Imported 2 file(s)"),
      {timeout:10000});
    assert.match(await page.locator("#advTree").innerText(),/RUNME.BAT/);
    await page.locator("#advancedFilesDrawer .close-drawer").click();

    const navigation=page.waitForEvent("framenavigated",{timeout:15000});
    await page.locator("#restartBtn").click();
    await page.locator("#acceptConfirmBtn").click();
    await navigation;
    await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running",
      {timeout:30000});
    assert.equal(await page.locator("#app").getAttribute("data-mode"),"dos");

    const chip=page.locator('#dosQuickBar button[data-dos-command]').first();
    await chip.evaluate(el=>{el.dataset.dosCommand="CD UPLOADS"});
    await chip.click(); await page.waitForTimeout(700);
    await chip.evaluate(el=>{el.dataset.dosCommand="RUNME"});
    await chip.click(); await page.waitForTimeout(4200);
    await page.screenshot({path:"/tmp/turboc-regression-bat.png"});
    await page.locator("#downloadBtn").click();
    await page.locator("#advSaveBtn").click();
    await page.waitForTimeout(400);
    await page.locator("#advRefreshBtn").click();
    if(!(await page.locator("#advTree").textContent()).includes("DOSMADE.C")) {
      console.log("DEBUG TREE",(await page.locator("#advTree").innerText()).slice(-800));
      console.log("DEBUG LOG",(await page.locator("#log").textContent()).slice(-800));
      throw new Error("DOS batch output missing in advanced regression");
    }
    assert.match(await page.locator("#advTree").textContent(),/DOSMADE.C/);
    await page.locator("#advancedFilesDrawer .close-drawer").click();

    const switchNavigation=page.waitForEvent("framenavigated",{timeout:15000});
    await page.locator("#modeTurbo").click();
    await page.locator("#acceptConfirmBtn").click();
    await switchNavigation;
    await page.waitForFunction(()=>document.getElementById("app").dataset.state==="running",
      {timeout:30000});
    assert.equal(await page.locator("#app").getAttribute("data-mode"),"turbo");
    await page.locator("#downloadBtn").click();
    assert.match(await page.locator("#fileList").innerText(),/DOSMADE.C/);
    assert.deepEqual(errors,[]);
    console.log("PASS: Full DOS prompt, ZIP import, DOS BAT execution, workspace save, mode-switch reload, and Turbo C shared files");
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
