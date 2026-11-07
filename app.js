(() => {
  "use strict";

  const SOURCE_ARCHIVE_URL = "Turboc3.zip?v=source-dir-fix";
  const EMULATORS_PATH_PREFIX =
    "https://cdn.jsdelivr.net/npm/js-dos@8.5.3/dist/emulators/";
  const SHOWCASE_PATH = "TURBOC3/Projects/SHOWCASE.C";
  const REQUIRED_RUNTIME_FILES = [
    "TURBOC3/BIN/TC.EXE",
    "TURBOC3/BIN/TCC.EXE",
    "TURBOC3/BIN/TLINK.EXE",
    "TURBOC3/INCLUDE/GRAPHICS.H",
    "TURBOC3/LIB/GRAPHICS.LIB",
    "TURBOC3/BGI/EGAVGA.BGI",
    SHOWCASE_PATH,
  ];

  const BGI_SELF_TEST = new URLSearchParams(location.search).has("bgi-test");
  const START_COMMAND = BGI_SELF_TEST
    ? `set PATH=C:\\TURBOC3\\BIN
cd \\TURBOC3\\PROJECTS
TCC.EXE -IC:\\TURBOC3\\INCLUDE -LC:\\TURBOC3\\LIB SHOWCASE.C C:\\TURBOC3\\LIB\\GRAPHICS.LIB
if errorlevel 1 goto compile_failed
SHOWCASE.EXE
goto self_test_done
:compile_failed
echo BGI_SELF_TEST_COMPILE_FAILED
:self_test_done`
    : `cd \\TURBOC3\\BIN
TC.EXE C:\\TURBOC3\\PROJECTS\\SHOWCASE.C`;

  const DOSBOX_CONF = `[sdl]
fullscreen=false
autolock=false

[dosbox]
memsize=32

[autoexec]
@echo off
mount c .
c:
${START_COMMAND}
`;

  const $ = (id) => document.getElementById(id);
  const ui = {
    container: $("dos-container"),
    startBtn: $("startBtn"),
    runtimeControls: $("runtimeControls"),
    restartBtn: $("restartBtn"),
    pauseBtn: $("pauseBtn"),
    fullscreenBtn: $("fullscreenBtn"),
    resetMouseBtn: $("resetMouseBtn"),
    mouseLockBtn: $("mouseLockBtn"),
    stopBtn: $("stopBtn"),
    diagnosticsBtn: $("diagnosticsBtn"),
    diagnosticsPanel: $("diagnosticsPanel"),
    runDiagnosticsBtn: $("runDiagnosticsBtn"),
    checks: $("checks"),
    clearLogBtn: $("clearLogBtn"),
    log: $("log"),
  };

  let player = null;
  let commandInterface = null;
  let frameObserver = null;
  let mouseResetTimer = null;
  let releaseMouseInput = null;
  let clickDiagnostics = { downs: 0, ups: 0, forcedReleases: 0 };
  let mouseLocked = false;
  let paused = false;
  let booting = false;
  let initFsPromise = null;
  let runtimeBytes = 0;
  let runtimeFileCount = 0;

  function timestamp() {
    return new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  }

  function log(message, data) {
    const suffix = data === undefined
      ? ""
      : ` ${typeof data === "string" ? data : JSON.stringify(data)}`;
    ui.log.textContent += `[${timestamp()}] ${message}${suffix}\n`;
    ui.log.scrollTop = ui.log.scrollHeight;
    console.log(`[Turbo C3] ${message}`, data ?? "");
  }

  function setControls(isRunning) {
    ui.startBtn.hidden = isRunning;
    ui.startBtn.disabled = booting;
    ui.startBtn.textContent = booting ? "Starting…" : "Start Turbo C3";

    ui.runtimeControls.hidden = !isRunning;
    const disabled = !isRunning || booting;
    ui.restartBtn.disabled = disabled;
    ui.pauseBtn.disabled = disabled;
    ui.fullscreenBtn.disabled = disabled;
    ui.resetMouseBtn.disabled = disabled || !commandInterface || BGI_SELF_TEST;
    ui.mouseLockBtn.disabled = disabled || !commandInterface;
    ui.mouseLockBtn.textContent = mouseLocked ? "Use pointer" : "Capture mouse";
    ui.stopBtn.disabled = disabled;
  }

  function showEmptyState() {
    if (document.getElementById("emptyState")) return;

    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.id = "emptyState";
    empty.innerHTML = `
      <div class="terminal-window">
        <div class="terminal-mark" aria-hidden="true">C:\\&gt;_</div>
        <div class="empty-label">Turbo C3</div>
        <div class="empty-hint">Click Start to launch the IDE</div>
      </div>`;
    ui.container.appendChild(empty);
  }

  function renderChecks(checks) {
    ui.checks.replaceChildren();
    for (const check of checks) {
      const card = document.createElement("div");
      card.className = "check";
      card.dataset.result = check.result;

      const title = document.createElement("strong");
      title.textContent = check.name;

      const detail = document.createElement("span");
      detail.textContent = check.detail;

      card.append(title, detail);
      ui.checks.appendChild(card);
    }
  }

  async function probeArchive() {
    const response = await fetch(SOURCE_ARCHIVE_URL, {
      method: "HEAD",
      cache: "force-cache",
    });

    if (!response.ok) {
      throw new Error(`Runtime archive returned HTTP ${response.status}`);
    }

    const bytes = Number(response.headers.get("content-length"));
    return Number.isFinite(bytes) && bytes > 0
      ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
      : "reachable";
  }

  async function prepareInitFs() {
    if (initFsPromise) return initFsPromise;

    initFsPromise = (async () => {
      if (typeof window.fflate?.unzip !== "function") {
        throw new Error("ZIP loader failed to load.");
      }

      log("Downloading optimized Turbo C3 runtime...");
      const response = await fetch(SOURCE_ARCHIVE_URL, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`Runtime archive returned HTTP ${response.status}`);
      }

      const compressed = new Uint8Array(await response.arrayBuffer());
      runtimeBytes = compressed.byteLength;
      log("Runtime downloaded", `${(runtimeBytes / 1024 / 1024).toFixed(2)} MiB`);

      const files = await new Promise((resolve, reject) => {
        window.fflate.unzip(compressed, (error, extracted) => {
          if (error) reject(error);
          else resolve(extracted);
        });
      });

      const missing = REQUIRED_RUNTIME_FILES.filter((path) => !files[path]);
      if (missing.length) {
        throw new Error(`Runtime is missing: ${missing.join(", ")}`);
      }

      const initFs = Object.entries(files)
        .filter(([path]) => !path.endsWith("/"))
        .map(([path, contents]) => ({ path, contents }));

      if (!initFs.length) {
        throw new Error("Turbo C3 runtime extracted with no files.");
      }

      runtimeFileCount = initFs.length;
      log("Runtime filesystem prepared", `${runtimeFileCount} files`);
      return initFs;
    })();

    try {
      return await initFsPromise;
    } catch (error) {
      initFsPromise = null;
      throw error;
    }
  }

  async function runDiagnostics() {
    ui.runDiagnosticsBtn.disabled = true;
    log("Running environment checks...");

    const checks = [];
    const add = (name, result, detail) => checks.push({ name, result, detail });

    add(
      "Protocol",
      location.protocol === "file:" ? "fail" : "pass",
      location.protocol === "file:"
        ? "Use HTTP/HTTPS; file:// cannot run js-dos correctly."
        : `${location.protocol}//`
    );

    add(
      "WebAssembly",
      typeof WebAssembly === "object" ? "pass" : "fail",
      typeof WebAssembly === "object" ? "Available" : "Required but unavailable"
    );

    add(
      "js-dos 8.5.3",
      typeof window.Dos === "function" ? "pass" : "fail",
      typeof window.Dos === "function" ? "Player API loaded" : "js-dos.js did not load"
    );

    add(
      "Direct mouse input",
      typeof commandInterface?.sendMouseButton === "function" ? "pass" : "warn",
      commandInterface
        ? "Backend release API available; browser pointer events are tracked"
        : "Checked after emulator starts"
    );
    add(
      "Mouse event trace",
      clickDiagnostics.downs > 0 ? "pass" : "warn",
      `downs=${clickDiagnostics.downs}, ups=${clickDiagnostics.ups}, DOS releases=${clickDiagnostics.forcedReleases}, last target=${clickDiagnostics.target || "none"}`
    );

    try {
      const archiveInfo = runtimeBytes
        ? `${(runtimeBytes / 1024 / 1024).toFixed(2)} MiB • ${runtimeFileCount || "loaded"} files`
        : await probeArchive();
      add("Runtime", "pass", archiveInfo);
    } catch (error) {
      add("Runtime", "fail", error.message);
    }

    renderChecks(checks);
    const failed = checks.filter((check) => check.result === "fail");
    log(failed.length ? "Diagnostics completed with failures" : "Diagnostics complete");
    ui.runDiagnosticsBtn.disabled = false;
    return failed.length === 0;
  }

  function cleanupMouseRecovery() {
    frameObserver?.disconnect();
    frameObserver = null;
    if (mouseResetTimer !== null) clearTimeout(mouseResetTimer);
    releaseMouseInput?.();
    releaseMouseInput = null;
    mouseResetTimer = null;
    clickDiagnostics = { downs: 0, ups: 0, forcedReleases: 0 };
    commandInterface = null;
    mouseLocked = false;
  }

  async function stopPlayer({ quiet = false } = {}) {
    const current = player;
    player = null;
    paused = false;
    booting = false;
    cleanupMouseRecovery();

    if (current) {
      try {
        await current.stop();
        if (!quiet) log("Emulator stopped");
      } catch (error) {
        log("Stop warning", error?.message || String(error));
      }
    }

    ui.container.replaceChildren();
    showEmptyState();
    ui.pauseBtn.textContent = "Pause";
    setControls(false);
  }

  // js-dos provides this backend-side cursor reset. Do not synthesize mouse
  // movement or subscribe to ci.events().onFrameSize: the renderer owns it.
  function resetMouse(reason = "manual") {
    if (!player || !commandInterface || typeof commandInterface.sendMouseSync !== "function") {
      return false;
    }

    commandInterface.sendMouseButton?.(0, false);
    commandInterface.sendMouseButton?.(1, false);
    commandInterface.sendMouseSync();
    log("Mouse buttons released and pointer synchronized", reason);
    return true;
  }

  function scheduleMouseReset(reason) {
    if (!commandInterface) return;
    if (mouseResetTimer !== null) clearTimeout(mouseResetTimer);
    mouseResetTimer = setTimeout(() => {
      mouseResetTimer = null;
      resetMouse(reason);
    }, 150);
  }

  function watchVideoMode() {
    frameObserver?.disconnect();
    let lastSize = null;
    frameObserver = new MutationObserver(() => {
      const canvas = ui.container.querySelector("canvas");
      if (!canvas) return;

      const size = `${canvas.width}x${canvas.height}`;
      if (lastSize !== null && lastSize !== size) {
        scheduleMouseReset(`DOS video mode changed to ${size}`);
      }
      lastSize = size;
    });
    frameObserver.observe(ui.container, {
      attributes: true,
      attributeFilter: ["width", "height"],
      childList: true,
      subtree: true,
    });

    // A canvas usually exists at ci-ready. If it does, record its size now.
    const canvas = ui.container.querySelector("canvas");
    if (canvas) lastSize = `${canvas.width}x${canvas.height}`;
  }

  // Mouse events cross from the browser to a DOSBox worker. A browser can
  // dispatch pointerdown/up in the same event-loop turn, too quickly for DOS
  // to observe the press before its release. Hold each press for at least
  // two video ticks; never send a preemptive release for a normal new click.
  // Coordinate mapping is from the live canvas, independently of its size.
  function installDirectMouseInput() {
    releaseMouseInput?.();
    releaseMouseInput = null;
    const ci = commandInterface;
    if (!ci || typeof ci.sendMouseButton !== "function" ||
        typeof ci.sendMouseMotion !== "function") return;

    const MIN_PRESS_MS = 50;
    let activePointer = null;
    let activeButton = 0;
    let pressedAt = 0;
    let releaseTimer = null;
    let downSent = false;

    function position(event) {
      const target = event.target;
      if (!(target instanceof Element) || !ui.container.contains(target)) return null;
      if (target.closest("button, input, a, [role='button']")) return null;
      const canvas = ui.container.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) return null;
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    }

    function release() {
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = null;
      if (!downSent) return;
      downSent = false;
      if (!player || commandInterface !== ci) return;
      ci.sendMouseButton(activeButton, false);
      clickDiagnostics.forcedReleases++;
    }

    function onDown(event) {
      if (mouseLocked || !player || commandInterface !== ci) return;
      if (event.button !== 0 && event.button !== 2) return;
      const xy = position(event);
      if (!xy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clickDiagnostics.downs++;
      clickDiagnostics.target = event.target.tagName.toLowerCase();
      release(); // only releases a genuinely pending prior press
      activePointer = event.pointerId;
      activeButton = event.button === 2 ? 1 : 0;
      ci.sendMouseMotion(xy.x, xy.y);
      ci.sendMouseButton(activeButton, true);
      pressedAt = performance.now();
      downSent = true;
    }

    function onMove(event) {
      if (mouseLocked || !player || commandInterface !== ci) return;
      const xy = position(event);
      if (!xy && event.pointerId !== activePointer) return;
      event.stopImmediatePropagation();
      if (xy) ci.sendMouseMotion(xy.x, xy.y);
    }

    function onUp(event) {
      if (mouseLocked || !player || commandInterface !== ci) return;
      if (event.pointerId !== activePointer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const xy = position(event);
      if (xy) ci.sendMouseMotion(xy.x, xy.y);
      activePointer = null;
      clickDiagnostics.ups++;
      const remaining = Math.max(0, MIN_PRESS_MS - (performance.now() - pressedAt));
      if (remaining === 0) release();
      else releaseTimer = setTimeout(release, remaining);
    }

    function onCancel(event) {
      if (!downSent || (event && event.pointerId !== undefined &&
          activePointer !== null && event.pointerId !== activePointer)) return;
      release();
      activePointer = null;
    }

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    releaseMouseInput = () => {
      onCancel();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
    };
  }

  function toggleMouseLock() {
    if (!player || !commandInterface || typeof player.setMouseCapture !== "function") return;
    resetMouse("switching pointer mode");
    mouseLocked = !mouseLocked;
    player.setMouseCapture(mouseLocked);
    if (!mouseLocked && document.pointerLockElement) {
      void document.exitPointerLock();
    }
    ui.mouseLockBtn.textContent = mouseLocked ? "Use pointer" : "Capture mouse";
    if (!mouseLocked) scheduleMouseReset("pointer mode restored");
    log("Mouse mode", mouseLocked ? "captured; click the emulator to lock, Escape to release"
                                   : "host pointer");
  }

  async function boot() {
    if (booting || player) return;

    booting = true;
    setControls(false);
    log("Starting Turbo C3");

    try {
      if (location.protocol === "file:") {
        throw new Error("Open this project through HTTP/HTTPS, not file://.");
      }
      if (typeof window.Dos !== "function") {
        throw new Error("js-dos failed to load.");
      }

      const initFs = await prepareInitFs();
      ui.container.replaceChildren();

      player = window.Dos(ui.container, {
        dosboxConf: DOSBOX_CONF,
        initFs,
        pathPrefix: EMULATORS_PATH_PREFIX,
        autoStart: true,
        autoSave: false,
        quickSave: false,
        mouseCapture: false,
        noCursor: false,
        theme: "dark",
        backend: "dosbox",
        backendLocked: true,
        workerThread: typeof SharedArrayBuffer === "function",
        imageRendering: "pixelated",
        renderBackend: "webgl",
        fsChanges: { local: false },
        onEvent: (event, arg) => {
          log(`js-dos event: ${event}`);

          if (event === "emu-ready") {
            const version = typeof player?.getVersion === "function" ? player.getVersion() : null;
            if (version) log("js-dos version", version);
          }

          if (event === "ci-ready") {
            commandInterface = arg || null;
            booting = false;
            watchVideoMode();
            installDirectMouseInput();
            setControls(true);
            scheduleMouseReset("emulator ready");
            ui.container.focus?.();
          }

          if (event === "fullscreen-change") {
            scheduleMouseReset("fullscreen changed");
          }
        },
      });

      if (typeof player.setNoCloud === "function") {
        player.setNoCloud(true);
      }
      if (typeof player.setMouseCapture === "function") {
        player.setMouseCapture(false);
      }
      if (typeof player.setNoCursor === "function") {
        player.setNoCursor(false);
      }
    } catch (error) {
      log("Startup failed", error?.stack || error?.message || String(error));
      booting = false;
      await stopPlayer({ quiet: true });
      ui.diagnosticsPanel.hidden = false;
      ui.diagnosticsBtn.setAttribute("aria-expanded", "true");
      await runDiagnostics();
    }
  }

  async function restart() {
    log("Restart requested");
    await stopPlayer({ quiet: true });
    await boot();
  }

  function togglePause() {
    if (!player || typeof player.setPaused !== "function") return;

    paused = !paused;
    player.setPaused(paused);
    ui.pauseBtn.textContent = paused ? "Resume" : "Pause";
    log(paused ? "Emulation paused" : "Emulation resumed");
  }

  function enterFullscreen() {
    if (!player || typeof player.setFullScreen !== "function") return;
    player.setFullScreen(true);
    log("Fullscreen requested");
  }

  function toggleDiagnostics() {
    const willOpen = ui.diagnosticsPanel.hidden;
    ui.diagnosticsPanel.hidden = !willOpen;
    ui.diagnosticsBtn.setAttribute("aria-expanded", String(willOpen));

    if (willOpen && ui.checks.childElementCount === 0) {
      void runDiagnostics();
    }
  }

  ui.startBtn.addEventListener("click", boot);
  ui.startBtn.addEventListener("pointerenter", () => void prepareInitFs(), { once: true });
  ui.startBtn.addEventListener("focus", () => void prepareInitFs(), { once: true });
  ui.restartBtn.addEventListener("click", restart);
  ui.pauseBtn.addEventListener("click", togglePause);
  ui.fullscreenBtn.addEventListener("click", enterFullscreen);
  ui.resetMouseBtn.addEventListener("click", () => resetMouse());
  ui.mouseLockBtn.addEventListener("click", toggleMouseLock);
  ui.stopBtn.addEventListener("click", () => stopPlayer());
  ui.diagnosticsBtn.addEventListener("click", toggleDiagnostics);
  ui.runDiagnosticsBtn.addEventListener("click", runDiagnostics);
  ui.clearLogBtn.addEventListener("click", () => { ui.log.textContent = ""; });
  document.addEventListener("fullscreenchange", () => scheduleMouseReset("browser fullscreen changed"));

  window.addEventListener("error", (event) => {
    log("Window error", event.message || String(event.error || event));
  });

  window.addEventListener("unhandledrejection", (event) => {
    log("Unhandled promise rejection", event.reason?.stack || event.reason?.message || String(event.reason));
  });

  document.addEventListener("DOMContentLoaded", () => {
    setControls(false);
    log("Turbo C3 Web Lab initialized");
  });
})();
