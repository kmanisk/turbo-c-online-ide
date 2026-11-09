"use strict";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_BINARY || undefined,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"]
  });
  const page = await browser.newPage({viewport:{width:1366,height:768}, acceptDownloads:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  try {
    await page.goto(process.env.TURBOC_TEST_URL || "http://127.0.0.1:8769/",{waitUntil:"domcontentloaded"});
    assert.equal(await page.title(),"Turbo C3 Web Lab");
    assert.equal(await page.locator("#startBtn").count(),0);
    assert.equal(await page.locator("#idleSampleSelect").count(),0);
    assert.equal(await page.locator("#drawerSampleSelect").count(),0);
    await page.waitForFunction(()=>document.querySelector("#app").dataset.state==="running",{timeout:30000});
    assert.equal(await page.locator(".toolbar").evaluate(el=>getComputedStyle(el).flexWrap),"nowrap");
    assert.equal(await page.locator("#headerFullscreenBtn").isVisible(),false);
    assert.equal(await page.locator("#fullscreenBtn").isVisible(),true);
    assert.equal(await page.locator("#stateLabel").evaluate(el=>getComputedStyle(el).position),"absolute");
    assert.equal(await page.locator(".workspace-footer").evaluate(el=>getComputedStyle(el).position),"absolute");
    await page.locator("#pauseBtn").click();
    assert.equal(await page.locator("#app").getAttribute("data-state"),"paused");
    await page.locator("#resumeBtn").click();
    assert.equal(await page.locator("#app").getAttribute("data-state"),"running");

    await page.locator(".toolbar-more > summary").click();
    await page.locator("#mouseLockBtn").click();
    assert.equal(await page.locator("#mouseLockBtn").getAttribute("aria-pressed"),"true");
    await page.locator("#mouseLockBtn").click();
    assert.equal(await page.locator("#mouseLockBtn").getAttribute("aria-pressed"),"false");
    assert.equal(await page.locator("#scaleButtonLabel").textContent(),"Fit");
    await page.locator("#scaleBtn").click();
    assert.equal(await page.locator("#scaleBtn").getAttribute("aria-pressed"),"true");
    await page.locator("#scaleBtn").click();
    assert.equal(await page.locator("#scaleBtn").getAttribute("aria-pressed"),"false");

    await page.locator("#helpBtn").click();
    assert(await page.locator("#helpDrawer").isVisible());
    await page.locator("#helpDrawer .close-drawer").click();
    await page.locator("#diagnosticsBtn").click();
    assert(await page.locator("#diagnosticsPanel").isVisible());
    assert.equal(await page.locator("#checks .check").count(),5);
    await page.locator("#diagnosticsPanel .close-drawer").click();

    await page.locator("#uploadBtn").click();
    await page.setInputFiles("#fileInput",{name:"VERIFY.C",mimeType:"text/plain",buffer:Buffer.from("#include <stdio.h>\r\nint main(){return 0;}\r\n")});
    await page.waitForTimeout(300);
    await page.locator("#downloadBtn").click();
    assert(await page.locator("#filesDrawer").isVisible());
    await page.locator("#fileList .file-row").filter({hasText:"VERIFY.C"}).click();
    const single=page.waitForEvent("download",{timeout:8000});
    await page.locator("#downloadSelectedBtn").click();
    assert.equal((await single).suggestedFilename(),"VERIFY.C");
    const zip=page.waitForEvent("download",{timeout:8000});
    await page.locator("#downloadZipBtn").click();
    assert.match((await zip).suggestedFilename(),/\.zip$/i);
    await page.locator("#filesDrawer .close-drawer").click();

    await page.locator("#themeBtn").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"),"classic");
    await page.locator("#fullscreenBtn").click();
    await page.waitForFunction(()=>document.fullscreenElement?.id==="monitor");
    await page.evaluate(()=>document.exitFullscreen());
    await page.waitForFunction(()=>!document.fullscreenElement);

    await page.locator("#restartBtn").click();
    assert(await page.locator("#confirmPopover").isVisible());
    await page.locator("#acceptConfirmBtn").click();
    await page.waitForFunction(()=>document.querySelector("#app").dataset.state==="running",{timeout:30000});
    await page.locator("#stopBtn").click();
    assert(await page.locator("#confirmPopover").isVisible());
    await page.locator("#acceptConfirmBtn").click();
    await page.waitForFunction(()=>document.querySelector("#app").dataset.state==="idle",{timeout:30000});

    assert.equal(await page.locator("#restartBtn").isEnabled(),true);
    const modeNav=page.waitForEvent("framenavigated",{timeout:15000});
    await page.locator("#modeDos").click();
    await modeNav;
    await page.waitForFunction(()=>document.querySelector("#app").dataset.mode==="dos" &&
      document.querySelector("#app").dataset.state==="running",{timeout:30000});
    assert.equal(await page.locator("#modeDos").getAttribute("aria-pressed"),"true");
    await page.locator("#dosSettingsBtn").click();
    assert(await page.locator("#settingsDrawer").isVisible());
    await page.locator("#settingsDrawer .close-drawer").click();
    assert.deepEqual(errors,[]);
    console.log("PASS: auto-launch, Pause/Resume, Stop, Restart, Upload, download files/ZIP, fullscreen, scale, mouse capture, single graphics demo, Turbo C/Full DOS, Help, Diagnostics, theme, DOS settings.");
  } finally {await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
