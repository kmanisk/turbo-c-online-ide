"use strict";

// Mocked player interaction test. This does not validate actual DOS mouse behavior.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_BINARY || undefined,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Provide the documented js-dos player/Command Interface surface without
  // downloading or starting a real DOS emulator.
  await page.route("**/js-dos.js", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }));
  await page.route("**/js-dos.css", (route) =>
    route.fulfill({ body: "", contentType: "text/css" }));
  await page.route("**/fflate@0.8.2/umd/index.js", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" }));
  await page.route("**/Turboc3.zip*", (route) =>
    route.fulfill({ body: Buffer.from([1]), contentType: "application/zip" }));

  await page.addInitScript(() => {
    const files = [
      "TURBOC3/BIN/TC.EXE",
      "TURBOC3/BIN/TCC.EXE",
      "TURBOC3/BIN/TLINK.EXE",
      "TURBOC3/INCLUDE/GRAPHICS.H",
      "TURBOC3/LIB/GRAPHICS.LIB",
      "TURBOC3/BGI/EGAVGA.BGI",
      "TURBOC3/Projects/SHOWCASE.C",
    ];
    window.fflate = {
      unzip: (_compressed, done) =>
        done(null, Object.fromEntries(files.map((key) => [key, new Uint8Array([1])]))),
    };

    const state = {
      syncCount: 0,
      captureModes: [],
      fullscreenStates: [],
      stopCount: 0,
      keys: [],
      buttonEvents: [],
      motions: [],
      canvas: null,
    };
    window.mockState = state;

    window.Dos = (container, options) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      container.appendChild(canvas);
      state.canvas = canvas;

      const ci = {
        sendMouseSync: () => { state.syncCount++; },
        simulateKeyPress: (...keys) => { state.keys.push(keys); },
        sendMouseButton: (button, pressed) => { state.buttonEvents.push([button, pressed]); },
        sendMouseMotion: (x, y) => { state.motions.push([x, y]); },
      };
      setTimeout(() => options.onEvent("ci-ready", ci), 5);

      return {
        setNoCloud() {},
        setNoCursor() {},
        setMouseCapture(enabled) { state.captureModes.push(enabled); },
        setFullScreen(enabled) {
          state.fullscreenStates.push(enabled);
          options.onEvent("fullscreen-change", enabled);
        },
        async stop() { state.stopCount++; },
      };
    };
  });

  try {
    const url = process.env.TURBOC_TEST_URL || "http://127.0.0.1:8765";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#startBtn").click();
    await page.waitForFunction(
      () => !document.querySelector("#runtimeControls").hidden
    );

    const initial = await page.evaluate(() => window.mockState.syncCount);
    await page.evaluate(() => {
      window.mockState.canvas.width = 720;
      window.mockState.canvas.height = 400;
    });
    await page.waitForTimeout(300);
    const changed = await page.evaluate(() => window.mockState.syncCount);
    assert(changed > initial, "Changing framebuffer dimensions must synchronize the mouse");

    await page.locator("#resetMouseBtn").click();
    const manualReset = await page.evaluate(() => ({
      keys: window.mockState.keys.slice(),
      sync: window.mockState.syncCount,
      events: window.mockState.buttonEvents.slice(),
    }));
    assert.deepEqual(manualReset.keys, [], "Reset must not inject IDE menu keys");
    assert(manualReset.sync > changed, "Reset should synchronize the pointer");
    assert.deepEqual(manualReset.events.slice(-2), [[0, false], [1, false]],
      "Reset must release any stuck buttons");

    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 80, y: 90 } });
    await canvas.click({ position: { x: 160, y: 100 } });
    await page.waitForTimeout(130);
    const clickState = await page.evaluate(() => ({
      events: window.mockState.buttonEvents.slice(),
      motions: window.mockState.motions.slice(),
    }));
    assert.deepEqual(clickState.events.slice(-4), [
      [0, true], [0, false],
      [0, true], [0, false],
    ], "Two independent clicks each need press and release");
    assert(clickState.motions.length >= 2, "Direct routing must send pointer coordinates");
    assert(clickState.motions.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1),
      "Pointer coordinates must be normalized");

    // Simulate a missing pointerup, then a second click. Both must be released.
    const beforeMissingUp = await page.evaluate(() => window.mockState.buttonEvents.length);
    await page.evaluate(() => {
      const rect = window.mockState.canvas.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, button: 0,
        clientX: rect.left + 80, clientY: rect.top + 80 };
      window.mockState.canvas.dispatchEvent(new PointerEvent("pointerdown",
        { ...opts, pointerId: 97 }));
      window.mockState.canvas.dispatchEvent(new PointerEvent("pointerdown",
        { ...opts, pointerId: 98 }));
      window.dispatchEvent(new PointerEvent("pointerup",
        { ...opts, pointerId: 98 }));
    });
    await page.waitForTimeout(130);
    const afterMissingUp = await page.evaluate((start) =>
      window.mockState.buttonEvents.slice(start), beforeMissingUp);
    assert.deepEqual(afterMissingUp, [
      [0, true], [0, false],
      [0, true], [0, false],
    ], "Lost release must be recovered before the next direct click");

    // The route must follow the current canvas after an emulator display rebuild.
    await page.evaluate(() => {
      const old = window.mockState.canvas;
      const replacement = document.createElement("canvas");
      replacement.width = 640;
      replacement.height = 480;
      old.replaceWith(replacement);
      window.mockState.canvas = replacement;
    });
    const priorRebuild = await page.evaluate(() => window.mockState.buttonEvents.length);
    await page.locator("canvas").click({position:{x:90,y:80}});
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(() => window.mockState.buttonEvents.length),
      priorRebuild + 2,
      "Direct routing must survive replacing the canvas"
    );

    await page.locator("#mouseLockBtn").click();
    assert.equal(await page.locator("#mouseLockBtn").textContent(), "Use pointer");
    await page.locator("#mouseLockBtn").click();
    assert.equal(await page.locator("#mouseLockBtn").textContent(), "Capture mouse");

    await page.locator("#fullscreenBtn").click();
    await page.waitForTimeout(250);
    const beforeStop = await page.evaluate(() => ({
      sync: window.mockState.syncCount,
      capture: window.mockState.captureModes,
      fullscreen: window.mockState.fullscreenStates,
    }));
    assert.deepEqual(beforeStop.capture.slice(-2), [true, false]);
    assert.deepEqual(beforeStop.fullscreen, [true]);
    assert(beforeStop.sync > manualReset.sync, "Fullscreen must synchronize the mouse");

    await page.locator("#stopBtn").click();
    assert.equal(await page.evaluate(() => window.mockState.stopCount), 1);
    assert.equal(await page.locator("#startBtn").isVisible(), true);
    assert.equal(await page.locator("#runtimeControls").isVisible(), false);

    await page.evaluate(() => { window.mockState.canvas.width = 320; });
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.mockState.syncCount),
      beforeStop.sync,
      "Stopped player must not keep resynchronizing"
    );

    assert.deepEqual(errors, []);
    console.log("PASS: live canvas mapping, repeated clicks, stale release recovery, reset, capture, fullscreen, cleanup");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
