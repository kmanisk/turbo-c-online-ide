(() => {
  "use strict";

  const SOURCE_ARCHIVE_URL = "Turboc3.zip?v=cpp-demo-1";
  const EMULATORS_PATH_PREFIX =
    "https://cdn.jsdelivr.net/npm/js-dos@8.5.3/dist/emulators/";
  const SHOWCASE_PATH = "TURBOC3/Projects/SHOWCASE.CPP";
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
TCC.EXE -IC:\\TURBOC3\\INCLUDE -LC:\\TURBOC3\\LIB SHOWCASE.CPP C:\\TURBOC3\\LIB\\GRAPHICS.LIB
if errorlevel 1 goto compile_failed
SHOWCASE.EXE
goto self_test_done
:compile_failed
echo BGI_SELF_TEST_COMPILE_FAILED
:self_test_done`
    : `cd \\TURBOC3\\BIN
TC.EXE C:\\TURBOC3\\PROJECTS\\SHOWCASE.CPP`;

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
    app: $("app"), container: $("dos-container"), screenArea: $("screenArea"), viewport: $("monitorViewport"), monitor: $("monitor"),
    restartBtn: $("restartBtn"), restartLabel: $("restartLabel"),
    pauseBtn: $("pauseBtn"), pauseLabel: $("pauseLabel"), resumeBtn: $("resumeBtn"), stopBtn: $("stopBtn"),
    fullscreenBtn: $("fullscreenBtn"), headerFullscreenBtn: $("headerFullscreenBtn"), scaleBtn: $("scaleBtn"),
    scaleButtonLabel: $("scaleButtonLabel"), scaleLabel: $("scaleLabel"),
    resetMouseBtn: $("resetMouseBtn"), mouseLockBtn: $("mouseLockBtn"), mouseLockLabel: $("mouseLockLabel"),
    helpBtn: $("helpBtn"), diagnosticsBtn: $("diagnosticsBtn"), themeBtn: $("themeBtn"),
    helpDrawer: $("helpDrawer"), filesDrawer: $("filesDrawer"), diagnosticsPanel: $("diagnosticsPanel"), drawerBackdrop: $("drawerBackdrop"),
    uploadBtn: $("uploadBtn"), drawerUploadBtn: $("drawerUploadBtn"), downloadBtn: $("downloadBtn"), fileInput: $("fileInput"),
    fileList: $("fileList"), refreshFilesBtn: $("refreshFilesBtn"), downloadSelectedBtn: $("downloadSelectedBtn"),
    downloadZipBtn: $("downloadZipBtn"), saveWorkspaceBtn: $("saveWorkspaceBtn"), resetWorkspaceBtn: $("resetWorkspaceBtn"),
    savedIndicator: $("savedIndicator"),
    fileSavedBadge: $("fileSavedBadge"), workspaceStorageLabel: $("workspaceStorageLabel"),
    runDiagnosticsBtn: $("runDiagnosticsBtn"), checks: $("checks"), log: $("log"), clearLogBtn: $("clearLogBtn"), copyLogBtn: $("copyLogBtn"),
    idleOverlay: $("idleOverlay"), loadingOverlay: $("loadingOverlay"), pausedOverlay: $("pausedOverlay"), errorOverlay: $("errorOverlay"),
    loadingFill: $("loadingFill"), loadingDetail: $("loadingDetail"), loadingCommand: $("loadingCommand"),
    stepDownload: $("stepDownload"), stepBoot: $("stepBoot"), stepLaunch: $("stepLaunch"),
    errorMessage: $("errorMessage"), errorFix: $("errorFix"), retryBtn: $("retryBtn"), copyErrorBtn: $("copyErrorBtn"),
    focusTip: $("focusTip"), focusBadge: $("focusBadge"), dismissTipBtn: $("dismissTipBtn"), stateLabel: $("stateLabel"),
    liveAnnouncer: $("liveAnnouncer"), crtToggle: $("crtToggle"), crtOverlay: $("crtOverlay"),
    confirmPopover: $("confirmPopover"), confirmTitle: $("confirmTitle"), confirmText: $("confirmText"),
    cancelConfirmBtn: $("cancelConfirmBtn"), acceptConfirmBtn: $("acceptConfirmBtn")
  };
  const STORE_NAME = "turbo-c-online-ide-sources";
  const WORK_DIR = "TURBOC3/Projects/";
  const SOURCE_PATTERN = /\.(?:C|CPP|H|HPP|TXT|DAT|EXE|OBJ)$/i;
  const SOURCE_MAX_BYTES = 1024 * 1024;
  let player = null;
  let commandInterface = null;
  let frameObserver = null;
  let mouseResetTimer = null;
  let releaseMouseInput = null;
  let clickDiagnostics = { downs:0, ups:0, forcedReleases:0 };
  let mouseLocked = false, paused = false, booting = false, focused = false;
  let initFsPromise = null, libsPromise = null, runtimeBytes = 0, runtimeFileCount = 0;
  let appState = "idle", scaleMode = "fit", activeDrawer = null, selectedFile = null;
  let confirmAction = null, confirmReturnFocus = null, workspaceDbPromise = null;
  let savedFiles = new Map(), stagedFiles = new Map();
  let workspaceResetPending = false;
  let disposedOnce = false;
  let selectedMode = BGI_SELF_TEST ? "turbo" : (safeSetting("turboc:mode","turbo")==="dos"?"dos":"turbo");
  let advanced = null, advancedPromise = null;
  let lastChecks = [], lastError = null, fileItems = [];

  function timeStamp() { return new Date().toLocaleTimeString("en-GB", {hour12:false}); }
  function log(message, data) {
    const suffix = data === undefined ? "" : " " + (typeof data === "string" ? data : JSON.stringify(data));
    ui.log.textContent += "[" + timeStamp() + "] " + message + suffix + "\n";
    ui.log.scrollTop = ui.log.scrollHeight;
  }
  function announce(message) { ui.liveAnnouncer.textContent = message; }
  function safeSetting(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function saveSetting(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Browser may deny storage. */ }
  }
  function updateTheme() {
    const theme = document.body.dataset.theme;
    ui.themeBtn.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    ui.themeBtn.setAttribute("aria-label", ui.themeBtn.title);
    ui.themeBtn.innerHTML = theme === "dark"
      ? '<svg class="icon"><use href="#i-moon"/></svg>'
      : '<svg class="icon"><use href="#i-sun"/></svg>';
  }
  function toggleTheme() {
    document.body.dataset.theme = document.body.dataset.theme === "classic" ? "dark" : "classic";
    saveSetting("turboc:theme", document.body.dataset.theme);
    updateTheme();
    announce("Theme: " + (document.body.dataset.theme === "classic" ? "Light" : "Dark"));
  }
  function setFocus(isFocused) {
    if (appState !== "running" && appState !== "paused") isFocused = false;
    focused = isFocused;
    ui.focusBadge.textContent = appState === "idle" ? "Stopped" :
      appState === "loading" ? "Loading" :
      appState === "error" ? "Error" :
      appState === "paused" ? "Paused" :
      (focused ? "Focused" : "Click to focus");
    ui.focusBadge.classList.toggle("is-focused", focused);
  }
  function setState(state, message) {
    appState = state;
    ui.app.dataset.state = state;
    ui.idleOverlay.hidden = state !== "idle";
    ui.loadingOverlay.hidden = state !== "loading";
    ui.pausedOverlay.hidden = state !== "paused";
    ui.errorOverlay.hidden = state !== "error";
    ui.stateLabel.textContent = message || ({idle:"Stopped",loading:"Loading",running:selectedMode==="dos"?"Running":"Running",paused:"Paused",error:"Error"}[state]);
    ui.restartBtn.disabled = state === "loading"; // Recovery after Stop without a Start screen.
    ui.pauseBtn.disabled = !["running", "paused"].includes(state);
    ui.stopBtn.disabled = !["running", "paused"].includes(state);
    ui.uploadBtn.disabled = state === "loading";
    ui.resetMouseBtn.disabled = !commandInterface || state !== "running" || BGI_SELF_TEST;
    ui.mouseLockBtn.disabled = !commandInterface || state !== "running";
    ui.pauseLabel.textContent = state === "paused" ? "Resume" : "Pause";
    ui.pauseBtn.setAttribute("aria-label", state === "paused" ? "Resume emulation" : "Pause emulation");
    $("modeTurbo").disabled = $("modeDos").disabled = state === "loading";
    if (state !== "running") setFocus(false);
    else setFocus(focused);
    announce(ui.stateLabel.textContent);
  }
  function setLoadingStep(step, detail) {
    const index = ["download","boot","launch","ready"].indexOf(step);
    ui.loadingFill.style.width = ["7%","50%","80%","100%"][Math.max(0,index)];
    [ui.stepDownload, ui.stepBoot, ui.stepLaunch].forEach((el,i)=>{
      el.classList.toggle("is-done", i<index);
      el.classList.toggle("is-active", i===index);
    });
    ui.loadingCommand.textContent = ["Downloading runtime","Starting DOSBox",selectedMode==="dos"?"Opening DOS prompt":"Launching Turbo C","Ready"][Math.max(0,index)];
    ui.loadingDetail.textContent = detail || "";
    ui.stateLabel.textContent = detail || "Loading";
  }
  function showError(error) {
    lastError = error;
    const msg = error?.message || String(error);
    let fix = "Check the runtime log under Diagnostics, then retry.";
    if (location.protocol === "file:") fix = "Serve the project through http://localhost or HTTPS. Do not open index.html with file://.";
    else if (typeof WebAssembly !== "object") fix = "Enable WebAssembly or update your browser.";
    else if (/fetch|network|load|failed/i.test(msg)) fix = "Check your connection and verify the pinned js-dos CDN and runtime files are accessible.";
    else if (/indexeddb|quota|storage/i.test(msg)) fix = "Browser storage may be restricted. Enable site storage or use file downloads.";
    ui.errorMessage.textContent = msg;
    ui.errorFix.textContent = fix;
    setState("error");
    log("Error", msg);
  }
  function renderChecks(checks) {
    ui.checks.replaceChildren();
    for (const check of checks) {
      const node = document.createElement("div");
      node.className = "check";
      node.dataset.result = check.result;
      const strong = document.createElement("strong");
      const sub = document.createElement("span");
      strong.textContent = check.name;
      sub.textContent = check.detail;
      node.append(strong, sub);
      ui.checks.appendChild(node);
    }
  }
  function runDiagnostics() {
    const checks = [];
    const add = (name,result,detail)=>checks.push({name,result,detail});
    add("Protocol",location.protocol==="file:"?"fail":"pass",location.protocol==="file:"?"Use HTTP/HTTPS, not file://":location.protocol + "//");
    add("WebAssembly",typeof WebAssembly==="object"?"pass":"fail",typeof WebAssembly==="object"?"Available":"Unavailable");
    add("js-dos version",typeof window.Dos==="function"?"pass":"warn",typeof window.Dos==="function"?"js-dos 8.5.3 loaded":"Loads when you click Start");
    add("Mouse mode",!commandInterface?"warn":"pass",!commandInterface?"Not started":mouseLocked?"Relative capture":"Direct pointer · downs "+clickDiagnostics.downs+" · ups "+clickDiagnostics.ups);
    add("Runtime size",runtimeBytes?"pass":"warn",runtimeBytes?(runtimeBytes /1048576).toFixed(2)+" MiB · "+runtimeFileCount+" files":"Not downloaded");
    lastChecks = checks;
    renderChecks(checks);
    return checks.every(c=>c.result!=="fail");
  }
  function diagnosticsText() {
    return "Turbo C Online IDE\n" + location.href + "\n" + lastChecks.map(c=>c.name+": "+c.result+" — "+c.detail).join("\n") + "\n\n"+ui.log.textContent;
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); announce("Copied to clipboard."); }
    catch { announce("Clipboard unavailable in this browser."); }
  }
  function layoutScreen() {
    // Fullscreen is intentionally immersive and fills every display pixel.
    // Windowed mode keeps the original 4:3 DOS geometry for unwarped pixels.
    const fullscreen = document.fullscreenElement === ui.monitor;
    const availableWidth = fullscreen ? window.innerWidth : ui.monitor.parentElement.clientWidth;
    const availableHeight = ui.viewport.clientHeight;
    if (!availableWidth || !availableHeight) return;
    const fitW = fullscreen ? availableWidth : Math.min(availableWidth - 2, availableHeight * 4 / 3);
    const shellWidth = Math.ceil(fitW + (fullscreen ? 0 : 2));
    ui.monitor.style.width = fullscreen ? "100%" : shellWidth + "px";
    ui.monitor.style.marginInline = "auto";
    const toolbar = document.querySelector(".toolbar");
    const footer = document.querySelector(".workspace-footer");
    const quickBar = $("dosQuickBar");
    for (const el of [toolbar, footer, quickBar]) {
      el.style.width = fullscreen ? "" : shellWidth + "px";
      el.style.marginInline = "auto";
    }
    ui.app.dataset.compact = String(shellWidth < 990);
    let width = fullscreen ? availableWidth : fitW;
    let height = fullscreen ? availableHeight : fitW * 3 / 4;
    if (!fullscreen && scaleMode === "pixel" && availableWidth >= 640 && availableHeight >= 480) {
      const multiple = Math.max(1, Math.floor(Math.min(availableWidth / 640, availableHeight / 480)));
      width = 640 * multiple;
      height = 480 * multiple;
    }
    ui.screenArea.style.width = Math.max(1, Math.floor(width)) + "px";
    ui.screenArea.style.height = Math.max(1, Math.floor(height)) + "px";
    // js-dos's 4/3 renderer letterboxes even a full-width host container.
    // 'Fit' is its documented render aspect that occupies the entire stage.
    if (typeof player?.setRenderAspect === "function") {
      player.setRenderAspect(fullscreen ? "Fit" : "4/3");
    }
    ui.scaleLabel.textContent = fullscreen
      ? "FILL · FULLSCREEN"
      : scaleMode === "pixel"
        ? (availableWidth >= 640 && availableHeight >= 480
            ? "PIXEL PERFECT · " + Math.round(width / 640) + "×"
            : "PIXEL PERFECT · FIT FALLBACK")
        : "FIT · 4:3";
  }
  function toggleScale() {
    scaleMode = scaleMode==="fit"?"pixel":"fit";
    ui.scaleButtonLabel.textContent = scaleMode==="fit"?"Fit":"Pixel";
    ui.scaleBtn.setAttribute("aria-pressed",String(scaleMode==="pixel"));
    saveSetting("turboc:scale",scaleMode);
    layoutScreen();
    scheduleMouseReset("display scale changed");
    announce(scaleMode==="fit"?"Fit to monitor":"Pixel-perfect size");
  }
  async function ensureAdvanced() {
    if (advanced) return advanced;
    if (advancedPromise) return advancedPromise;
    advancedPromise = (async () => {
      await loadScript("advanced.js?v=1");
      if (typeof window.createAdvancedMode !== "function") throw Error("Advanced mode module could not load");
      const api = await window.createAdvancedMode({
        getCI:()=>commandInterface, getState:()=>appState, getSaved:()=>savedFiles,
        isBundled:(path)=>{
          const normalized=path.toUpperCase();
          return ["TURBOC3/BIN/","TURBOC3/BGI/","TURBOC3/LIB/","TURBOC3/INCLUDE/","TURBOC3/SOURCE/"].some(prefix=>normalized.startsWith(prefix));
        },
        stage:async(path,bytes)=>{
          const key=path.replace(/\\/g,"/").toUpperCase();
          if (key.includes("..") || key.startsWith("/") || !key.includes("/")) throw Error("Invalid DOS file path");
          savedFiles.set(key,bytes);
          stagedFiles.set(key,bytes);
          workspaceResetPending=false;
          markSaved("pending");
          if(!await writeSavedFiles()) throw Error("Browser storage rejected this file");
        },
        remove:async(path)=>{
          const key=path.toUpperCase();
          savedFiles.delete(key);stagedFiles.delete(key);
          if(key.startsWith(WORK_DIR.toUpperCase())){
            const basename=key.split("/").pop();
            savedFiles.delete(basename);stagedFiles.delete(basename);
          }
          await writeSavedFiles();
        },
        saveWorkspace:()=>saveWorkspace(),
        reset:()=>resetSavedWorkspace(),
        confirm:(button,title,message,fn)=>askConfirm(button,title,message,fn),
        restart:()=>restart(),
        closeDrawer:()=>closeDrawer(),
        download:(name,bytes,mime)=>downloadBytes(name,bytes,mime),
        ensureZip:()=>ensureZipLibrary(), announce, log,
        setScale:(scale)=>{
          scaleMode=scale==="pixel"?"pixel":"fit";
          ui.scaleButtonLabel.textContent=scaleMode==="pixel"?"Pixel":"Fit";
          ui.scaleBtn.setAttribute("aria-pressed",String(scaleMode==="pixel"));
          layoutScreen();
        }
      });
      advanced=api;
      return api;
    })().catch(e=>{advancedPromise=null;throw e});
    return advancedPromise;
  }
  function updateModeUI() {
    const isDos=selectedMode==="dos";
    ui.app.dataset.mode=selectedMode;
    $("modeTurbo").setAttribute("aria-pressed",String(!isDos));
    $("modeDos").setAttribute("aria-pressed",String(isDos));
    $("dosQuickBar").hidden=!isDos;
    $("dosHelp").hidden=!isDos;
    $("windowTitle").textContent=isDos?"DOSBOX — C:\\>":"TURBOC3 — NONAME00.CPP";
    $("stepLaunch").textContent=isDos?"03 · Opening DOS prompt":"03 · Launching Turbo C";
    $("loadingRoot").textContent=isDos?"C:\\>":"C:\\TURBOC3>";
    $("errorTitle").textContent=isDos?"Could not start Full DOS":"Could not start Turbo C";
    $("workspaceHint").textContent=isDos?"DIR · CD · MD · COPY · DEL · TC":"F2 Save · Alt+F9 Compile · Ctrl+F9 Run";
    ui.uploadBtn.title=isDos?"Upload DOS software and archives":"Import .c or .cpp file";
    setState(appState);
  }
  async function selectMode(next,button) {
    if(BGI_SELF_TEST || next===selectedMode)return;
    const change=async()=>{
      const wasRunning=Boolean(player);
      if(wasRunning && !workspaceResetPending && !await saveWorkspace({quiet:true})) {
        announce("Could not save workspace. Download files before switching modes.");
        return;
      }
      if(next==="dos" && !wasRunning)await ensureAdvanced();
      selectedMode=next;
      saveSetting("turboc:mode",next);
      updateModeUI();
      if(wasRunning || disposedOnce) reloadForFreshEmulator();
      else if(next==="dos") announce("Full DOS selected. Start to open C:\\>.");
    };
    if(player || appState==="paused"){
      askConfirm(button,"Switch emulator mode?","The DOS session will restart. Save any changes in Turbo C with F2 before switching.",change);
    } else {
      try{await change();}
      catch(e){log("Mode switch failed",e.message);showError(e);}
    }
  }
  function openDrawer(name) {
    closePopover();
    closeDrawer();
    activeDrawer = name;
    const node = ({help:ui.helpDrawer,files:ui.filesDrawer,diagnostics:ui.diagnosticsPanel,advancedFiles:advanced?.ui.advancedFilesDrawer,settings:advanced?.ui.settingsDrawer})[name];
    if (!node) return;
    node.hidden = false;
    ui.drawerBackdrop.hidden = false;
    document.body.classList.add("drawer-open");
    node.querySelector(".close-drawer")?.focus();
    if (name==="diagnostics") runDiagnostics();
    if (name==="files") void refreshFiles();
    if (name==="advancedFiles") void advanced?.onOpenFiles();
  }
  function closeDrawer() {
    if (!activeDrawer) return;
    const origin = ({help:ui.helpBtn,files:ui.downloadBtn,diagnostics:ui.diagnosticsBtn,advancedFiles:ui.downloadBtn,settings:$("dosSettingsBtn")})[activeDrawer];
    ui.helpDrawer.hidden = ui.filesDrawer.hidden = ui.diagnosticsPanel.hidden = true;
    if (advanced) advanced.ui.advancedFilesDrawer.hidden = advanced.ui.settingsDrawer.hidden = true;
    ui.drawerBackdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    activeDrawer = null;
    origin?.focus();
  }
  function closePopover() {
    ui.confirmPopover.hidden = true;
    confirmAction = null;
    confirmReturnFocus?.focus();
    confirmReturnFocus = null;
  }
  function askConfirm(button,title,body,action) {
    closePopover();
    confirmAction = action;
    confirmReturnFocus = button;
    ui.confirmTitle.textContent = title;
    ui.confirmText.textContent = body;
    ui.confirmPopover.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = Math.min(330, innerWidth-24);
    ui.confirmPopover.style.left = Math.max(12,Math.min(innerWidth-width-12,rect.left))+"px";
    ui.confirmPopover.style.top = Math.max(12,Math.min(innerHeight-145,rect.top-150))+"px";
    ui.cancelConfirmBtn.focus();
  }
  function markSaved(status) {
    const saved = status === "saved";
    ui.savedIndicator.textContent = saved?"Saved in this browser":status==="pending"?"Unsaved changes":status==="unavailable"?"Storage unavailable":"No files saved";
    ui.fileSavedBadge.textContent = ui.savedIndicator.textContent;
    ui.savedIndicator.classList.toggle("is-saved",saved);
    ui.fileSavedBadge.classList.toggle("is-saved",saved);
  }
  function setFocusTip(show) {
    ui.focusTip.hidden = !show;
  }
  function togglePause() {
    if (!player || !["running","paused"].includes(appState)) return;
    paused = !paused;
    player.setPaused(paused);
    setState(paused?"paused":"running");
    log(paused?"Emulator paused":"Emulator resumed");
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      void ui.monitor.requestFullscreen().then(layoutScreen).catch(e=>{log("Fullscreen unavailable",e.message); announce("Fullscreen unavailable");});
    } else void document.exitFullscreen();
  }

  async function prepareInitFs() {
    if (initFsPromise) return initFsPromise;

    initFsPromise = (async () => {
      if (typeof window.fflate?.unzip !== "function") {
        throw new Error("ZIP loader failed to load.");
      }

      log("Downloading optimized Turbo C3 runtime...");
      setLoadingStep("download","Downloading runtime (2.46 MiB)");
      const response = await fetch(SOURCE_ARCHIVE_URL, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`Runtime archive returned HTTP ${response.status}`);
      }

      const compressed = new Uint8Array(await response.arrayBuffer());
      runtimeBytes = compressed.byteLength;
      setLoadingStep("download","Runtime downloaded · extracting files");
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
      setLoadingStep("boot","DOS filesystem ready · "+runtimeFileCount+" files");
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

  // Explicit guest-side recovery for Turbo C's legacy mouse state.
  // Repaint desktop is the first item in its Alt+Space system menu.
  // Never inject this automatically during compilation or another DOS program.
  let repairingMouse = false;
  async function repairMouse() {
    if (repairingMouse || !resetMouse("mouse repair requested")) return;
    if (selectedMode !== "turbo" || appState !== "running" ||
        typeof commandInterface?.sendKeyEvent !== "function") return;
    repairingMouse = true;
    const ci = commandInterface;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const send = (code, pressed) => {
      if (commandInterface === ci && player) ci.sendKeyEvent(code, pressed);
    };
    try {
      send(342, true);   // Left Alt
      await wait(70);
      send(32, true);    // Space: open the Turbo C system menu
      await wait(75);
      send(32, false);
      await wait(45);
      send(342, false);
      await wait(150);
      send(257, true);  // Enter: Repaint desktop
      await wait(75);
      send(257, false);
      await wait(125);
      resetMouse("Turbo C desktop repainted");
      announce("Turbo C desktop repainted and DOS mouse resynchronized.");
    } finally {
      repairingMouse = false;
    }
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

  // The DOSBox backend samples button state on a separate worker tick.
  // Press/release sequences can merge if two clicks arrive too closely.
  // Serialize complete mouse clicks and leave an observable up-state gap.
  // No repeating input timers or polling is used.
  function installDirectMouseInput() {
    releaseMouseInput?.();
    releaseMouseInput = null;
    const ci = commandInterface;
    if (!ci || typeof ci.sendMouseButton !== "function" ||
        typeof ci.sendMouseMotion !== "function") return;

    const MIN_PRESS_MS = 90;
    const MIN_RELEASE_GAP_MS = 40;
    const MAX_HOLD_MS = 12000;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let alive = true;
    let active = null;
    let queue = Promise.resolve();
    let lastMotionAt = 0;
    let lastMotionX = -1, lastMotionY = -1;

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
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      };
    }

    function available() {
      return alive && !mouseLocked && player && commandInterface === ci;
    }

    // Normal DOS mouse clicks must never wait for screenshots or guest
    // recovery. A previously broken mouse driver can ignore an entire click,
    // so verify only top-menu interactions off the input queue.
    //
    // An active Turbo C menu changes a large part of the upper DOS screen.
    // Checking a single green menu highlight was unreliable (e.g. Run->File,
    // system menu, Help dialogs) and repeatedly repainted the whole desktop.
    let clickSequence = 0;
    let checkingRecovery = false;

    function looksLikeIdeMenu(image) {
      if (selectedMode !== "turbo" || !image?.data ||
          image.width !== 640 || image.height !== 400) return false;
      // DOS graphics programs do not have Turbo C's broad light-gray menu bar.
      let neutral = 0;
      for (let x = 20; x < 620; x += 20) {
        const i = 4 * (9 * image.width + x);
        const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
        if (r >= 130 && r <= 200 &&
            Math.abs(r - g) < 12 && Math.abs(g - b) < 12) neutral++;
      }
      return neutral >= 10;
    }

    function menuFrameChanged(before, after) {
      if (!before?.data || !after?.data ||
          before.width !== after.width || before.height !== after.height) return null;
      // Ignore the header hover highlight and mouse cursor; only compare
      // the large popup/dialog area. This also detects menus other than File.
      let changed = 0;
      for (let y = 22; y < 215; y += 4) {
        for (let x = 8; x < 632; x += 4) {
          const i = 4 * (y * before.width + x);
          const delta = Math.abs(before.data[i] - after.data[i]) +
            Math.abs(before.data[i + 1] - after.data[i + 1]) +
            Math.abs(before.data[i + 2] - after.data[i + 2]);
          if (delta > 55 && ++changed >= 48) return true;
        }
      }
      return false;
    }

    async function verifyMenuClick(action, before, sequence) {
      if (!before || !looksLikeIdeMenu(before) || checkingRecovery) return;
      const stillCurrent = () => available() && !active &&
        sequence === clickSequence && selectedMode === "turbo";
      const changed = async () => {
        if (!stillCurrent()) return null;
        try {
          return menuFrameChanged(before, await ci.screenshot());
        } catch (error) {
          log("Mouse menu verification unavailable", error?.message || String(error));
          return null;
        }
      };
      await wait(120);
      let result = await changed();
      if (result !== false) return;
      // A slow DOS redraw is not a lost click. Give Turbo C a second frame
      // and abort immediately when a newer pointer interaction starts.
      await wait(120);
      result = await changed();
      if (result !== false || !stillCurrent()) return;
      checkingRecovery = true;
      try {
        log("Turbo C ignored menu click; repainting and retrying once");
        await repairMouse();
        if (!stillCurrent()) return;
        ci.sendMouseMotion(action.start.x, action.start.y);
        ci.sendMouseButton(action.button, true);
        await wait(MIN_PRESS_MS);
        if (!available()) return;
        ci.sendMouseButton(action.button, false);
        ci.sendMouseSync?.();
        clickDiagnostics.downs++;
        clickDiagnostics.ups++;
        await wait(100);
        const recovered = await changed();
        if (recovered === true) {
          log("Turbo C menu recovered automatically");
        } else if (recovered === false) {
          log("Menu did not respond after automatic mouse recovery");
          announce("Use Repair mouse in More if Turbo C still ignores clicks.");
        }
      } finally {
        checkingRecovery = false;
      }
    }

    async function dispatch(action) {
      if (!available()) return;
      const button = action.button;
      const isMenuClick = selectedMode === "turbo" &&
        button === 0 && action.start.y > 0 && action.start.y < 0.048 &&
        action.start.x > 0.028 && action.start.x < 0.99;
      // The pre-click frame is optional. A screenshot error must never block
      // input, and normal clicks are sent as soon as the small read completes.
      let before = null;
      if (isMenuClick && !checkingRecovery && typeof ci.screenshot === "function") {
        try { before = await ci.screenshot(); }
        catch (error) { log("Mouse screenshot unavailable", error?.message || String(error)); }
      }
      let pressed = false;
      let timeout = null;
      try {
        ci.sendMouseMotion(action.start.x, action.start.y);
        ci.sendMouseButton(button, true);
        pressed = true;
        clickDiagnostics.downs++;
        const startedAt = performance.now();

        await Promise.race([
          action.finished,
          new Promise(resolve => { timeout = setTimeout(resolve, MAX_HOLD_MS); })
        ]);
        if (timeout !== null) clearTimeout(timeout);
        const remaining = Math.max(0, MIN_PRESS_MS - (performance.now() - startedAt));
        if (remaining) await wait(remaining);
        if (!alive || commandInterface !== ci || !player) return;
        if (action.end) ci.sendMouseMotion(action.end.x, action.end.y);
        ci.sendMouseButton(button, false);
        pressed = false;
        clickDiagnostics.ups++;
        ci.sendMouseSync?.();
        // One-shot recovery runs independently of the click queue. Opening
        // another menu no longer waits for screenshots, repaint or retry.
        if (isMenuClick && before && !checkingRecovery) {
          void verifyMenuClick(action, before, action.sequence)
            .catch(error => log("Mouse recovery check failed", error?.message || String(error)));
        }
      } finally {
        if (timeout !== null) clearTimeout(timeout);
        if (pressed && alive && commandInterface === ci && player) {
          ci.sendMouseButton(button, false);
          ci.sendMouseSync?.();
          clickDiagnostics.forcedReleases++;
        }
        if (alive) await wait(MIN_RELEASE_GAP_MS);
      }
    }

    function onDown(event) {
      if (!available() || active || (event.button !== 0 && event.button !== 2)) return;
      const xy = position(event);
      if (!xy) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const action = {
        pointerId: event.pointerId,
        button: event.button === 2 ? 1 : 0,
        start: xy, end: xy, sequence: ++clickSequence, finish: null, finished: null
      };
      action.finished = new Promise(resolve => { action.finish = resolve; });
      active = action;
      clickDiagnostics.target = event.target.tagName.toLowerCase();
      const next = queue.then(() => dispatch(action));
      queue = next.catch(error => log("DOS mouse dispatch failed", error.message));
    }

    function onMove(event) {
      if (!available()) return;
      const xy = position(event);
      if (!xy && (!active || active.pointerId !== event.pointerId)) return;
      event.stopImmediatePropagation();
      if (xy) {
        if (active) active.end = xy;
        // High-rate native Wayland mice can overwhelm the DOSBox input queue.
        // Coalesce redundant motion to ~60Hz; every press/release still sends
        // its exact final coordinates. No animation loop or persistent timer.
        const now=performance.now();
        if (now-lastMotionAt >= 16 &&
            (Math.abs(xy.x-lastMotionX)>0.0002 || Math.abs(xy.y-lastMotionY)>0.0002)) {
          ci.sendMouseMotion(xy.x, xy.y);
          lastMotionAt=now;
          lastMotionX=xy.x; lastMotionY=xy.y;
        }
      }
    }

    function finishPointer(event, cancelled = false) {
      if (!active) return;
      if (event && event.pointerId !== undefined && event.pointerId !== active.pointerId) return;
      if (event?.type === "pointerup") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (!cancelled && event) active.end = position(event) || active.end;
      if (cancelled) clickDiagnostics.forcedReleases++;
      active.done = true;
      active.finish();
      active = null;
    }

    function onUp(event) { finishPointer(event); }
    function onCancel(event) { finishPointer(event, true); }

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    releaseMouseInput = () => {
      onCancel();
      alive = false;
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
      if (commandInterface === ci) {
        ci.sendMouseButton(0, false);
        ci.sendMouseButton(1, false);
        ci.sendMouseSync?.();
      }
    };
  }

  function openWorkspaceDb() {
    if (workspaceDbPromise) return workspaceDbPromise;
    workspaceDbPromise = new Promise((resolve,reject)=>{
      if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
      const request = indexedDB.open(STORE_NAME, 1);
      request.onupgradeneeded = ()=>{ if(!request.result.objectStoreNames.contains("sources")) request.result.createObjectStore("sources",{keyPath:"name"}); };
      request.onsuccess = ()=>resolve(request.result);
      request.onerror = ()=>reject(request.error || new Error("Cannot open local storage"));
      request.onblocked = ()=>reject(new Error("Workspace storage is blocked by another tab"));
    }).catch(e=>{ workspaceDbPromise=null; markSaved("unavailable"); throw e; });
    return workspaceDbPromise;
  }
  async function loadSavedFiles() {
    try {
      const db = await openWorkspaceDb();
      const rows = await new Promise((resolve,reject)=>{
        const tx=db.transaction("sources","readonly");
        const req=tx.objectStore("sources").getAll();
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
      });
      savedFiles=new Map(rows.map(row=>[row.name,new Uint8Array(row.bytes)]));
      if (savedFiles.size) markSaved("saved");
      return savedFiles;
    } catch(e) {
      log("Local storage unavailable",e.message);
      ui.workspaceStorageLabel.textContent="Storage unavailable; download your files";
      return savedFiles;
    }
  }
  async function writeSavedFiles() {
    try {
      const db=await openWorkspaceDb();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction("sources","readwrite");
        const store=tx.objectStore("sources");
        store.clear();
        for (const [name, bytes] of savedFiles) store.put({name,bytes});
        tx.oncomplete=resolve;
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error || new Error("Local save cancelled"));
      });
      markSaved(savedFiles.size?"saved":"clean");
      return true;
    } catch(e) {
      markSaved("unavailable");
      log("Workspace save failed",e.message);
      announce("Storage unavailable. Download your files to avoid losing work.");
      return false;
    }
  }
  function fileSize(bytes) {
    return bytes < 1024 ? bytes+" B" : (bytes/1024).toFixed(1)+" KiB";
  }
  function dosFileName(name) {
    const original=String(name).replace(/^.*[\\/]/,"").toUpperCase();
    const dot=original.lastIndexOf(".");
    const raw = dot > 0 ? original.slice(0,dot) : original;
    const ext = dot > 0 ? original.slice(dot+1) : "C";
    const clean=raw.replace(/[^A-Z0-9_]/g,"").slice(0,8) || "SOURCE";
    const fixedExt=["C","CPP","H","HPP","TXT"].includes(ext)?ext:"C";
    return clean+"."+fixedExt;
  }
  function uniqueFileName(name) {
    if (!savedFiles.has(name) && !stagedFiles.has(name)) return name;
    const i=name.lastIndexOf(".");
    const base=name.slice(0,i),ext=name.slice(i);
    for (let n=2;n<=99;n++) {
      const suffix=String(n);
      const candidate=base.slice(0,8-suffix.length)+suffix+ext;
      if(!savedFiles.has(candidate) && !stagedFiles.has(candidate)) return candidate;
    }
    throw new Error("Too many files with the same name");
  }
  function projectFolder(tree) {
    let cursor=tree;
    for (const part of ["TURBOC3","Projects"]) {
      cursor=cursor?.nodes?.find(entry=>entry.name.toLowerCase()===part.toLowerCase());
    }
    return cursor;
  }
  async function projectFilesFromGuest() {
    if (!commandInterface || typeof commandInterface.fsTree!=="function") return [];
    const tree=await commandInterface.fsTree();
    const folder=projectFolder(tree);
    if(!folder?.nodes) return [];
    return folder.nodes.filter(node=>node.nodes===null && SOURCE_PATTERN.test(node.name))
      .filter(node=>node.size===null || node.size<=SOURCE_MAX_BYTES)
      .map(node=>({name:node.name.toUpperCase(),size:node.size??0}));
  }
  function renderFileList() {
    const entries=new Map();
    for (const [name,bytes] of savedFiles) {
      if(name.includes("/") && !name.toUpperCase().startsWith(WORK_DIR.toUpperCase()))continue;
      const filename=name.split("/").pop();
      entries.set(filename,{name:filename,size:bytes.length});
    }
    for (const item of fileItems) entries.set(item.name,item);
    const sorted=[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name));
    ui.fileList.replaceChildren();
    if (!sorted.length) {
      const p=document.createElement("p");
      p.className="muted"; p.textContent="No source files yet. Upload one or select a sample.";
      ui.fileList.append(p);
    }
    for (const item of sorted) {
      const row=document.createElement("button");
      row.type="button";row.className="file-row"+(selectedFile===item.name?" selected":"");
      row.setAttribute("role","option");row.setAttribute("aria-selected",String(selectedFile===item.name));
      const label=document.createElement("span");label.textContent=item.name;
      const size=document.createElement("span");size.textContent=fileSize(item.size);
      row.append(label,size);
      row.addEventListener("click",()=>{selectedFile=item.name;renderFileList();});
      ui.fileList.append(row);
    }
    if (selectedFile && !entries.has(selectedFile)) selectedFile=null;
    ui.downloadSelectedBtn.disabled=!selectedFile;
    ui.downloadZipBtn.disabled=!sorted.length;
  }
  async function refreshFiles() {
    try { fileItems=await projectFilesFromGuest(); }
    catch(e) { log("File listing unavailable",e.message); fileItems=[]; }
    renderFileList();
  }
  async function readGuestFile(name) {
    if (!commandInterface?.fsReadFile) return null;
    try { return new Uint8Array(await commandInterface.fsReadFile(WORK_DIR+name)); }
    catch(e) { log("Guest read failed: "+name,e.message); return null; }
  }
  async function collectProjectFiles() {
    const all=new Map(savedFiles);
    if (!commandInterface) return all;
    if (selectedMode!=="dos") {
      const items=await projectFilesFromGuest();
      for(const item of items) {
        const data=await readGuestFile(item.name);
        if(data) all.set(item.name,data);
      }
      return all;
    }
    // Full DOS: snapshot new files anywhere on C:, not only Projects.
    // Bundled compiler/runtime files remain immutable and are not duplicated in IndexedDB.
    const runtime=await prepareInitFs();
    const bundled=new Set(runtime.map(entry=>entry.path.toUpperCase()));
    const tree=await commandInterface.fsTree();
    let total=0;
    const walk=async(node,path)=>{
      if(Array.isArray(node.nodes)) {
        for(const child of node.nodes) await walk(child,path?path+"/"+child.name:child.name);
        return;
      }
      const upper=path.toUpperCase();
      if(upper.startsWith(".JSDOS/"))return;
      const inProjects=upper.startsWith("TURBOC3/PROJECTS/");
      if(!inProjects && bundled.has(upper))return;
      if(node.size && node.size>64*1024*1024)return;
      if(total>128*1024*1024)return;
      const bytes=await commandInterface.fsReadFile(path);
      if(bytes.byteLength>64*1024*1024)return;
      total+=bytes.byteLength;
      const key=inProjects?upper.split("/").pop():upper;
      all.set(key,new Uint8Array(bytes));
    };
    if(tree?.nodes)await walk(tree,"");
    return all;
  }
  async function saveWorkspace({quiet=false}={}) {
    if (workspaceResetPending && quiet) return false;
    if (!quiet) workspaceResetPending = false;
    if (commandInterface) {
      try { savedFiles=await collectProjectFiles(); }
      catch(e) { log("Could not snapshot workspace",e.message); }
    }
    const success=await writeSavedFiles();
    if (!quiet) announce(success?"Workspace saved in this browser":"Could not save locally. Download important files.");
    return success;
  }
  async function stageFile(name,bytes) {
    if (bytes.length>SOURCE_MAX_BYTES) throw new Error("File exceeds the 1 MiB source-file limit");
    if (!bytes.length) throw new Error("The source file is empty");
    const clean=uniqueFileName(dosFileName(name));
    stagedFiles.set(clean,bytes);
    savedFiles.set(clean,bytes);
    workspaceResetPending = false;
    markSaved("pending");
    await writeSavedFiles();
    if (commandInterface && typeof commandInterface.fsWriteFile==="function") {
      try {
        await commandInterface.fsWriteFile(WORK_DIR+clean,bytes);
        log("Imported into DOS file system",clean);
        announce(clean+" imported. Use F3 and open C:\\TURBOC3\\PROJECTS\\"+clean+". If missing, restart to remount.");
      } catch(e) {
        log("Live file import deferred",e.message);
        announce(clean+" saved. Restart the emulator to make it available.");
      }
    } else announce(clean+" saved. Use Restart to launch Turbo C.");
    await refreshFiles();
    return clean;
  }
  async function uploadFiles(list) {
    for(const file of list) {
      if(!/\.(?:c|cpp|h|hpp)$/i.test(file.name)) { announce("Choose a .c, .cpp or .h file."); continue; }
      try {
        const bytes=new Uint8Array(await file.arrayBuffer());
        await stageFile(file.name,bytes);
      } catch(e) { log("Upload failed",e.message); announce("Upload failed: "+e.message); }
    }
    ui.fileInput.value="";
  }
  async function downloadSingle(name) {
    const data=await readGuestFile(name) || savedFiles.get(name);
    if(!data) { announce("File is unavailable. Save in Turbo C first."); return; }
    downloadBytes(name,data,"application/octet-stream");
  }
  function downloadBytes(name,bytes,mime) {
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    const link=document.createElement("a");
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function ensureZipLibrary() {
    if (typeof window.fflate?.zipSync==="function") return;
    await loadScript("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js");
  }
  async function downloadZip() {
    try {
      const files=await collectProjectFiles();
      if (!files.size) { announce("No files to export."); return; }
      await ensureZipLibrary();
      const input=Object.fromEntries([...files].map(([name,data])=>[name,data]));
      const zipped=window.fflate.zipSync(input,{level:4});
      downloadBytes("TURBOC3-PROJECTS.zip",zipped,"application/zip");
      announce("Workspace ZIP downloaded.");
    } catch(e){log("ZIP export failed",e.message); announce("Could not export workspace ZIP.");}
  }
  async function resetSavedWorkspace() {
    workspaceResetPending = true;
    savedFiles.clear();stagedFiles.clear();
    await writeSavedFiles();
    await refreshFiles();
    announce("Saved browser workspace reset. Restart the emulator for a clean session.");
  }

  const JS_DOS_URL="https://cdn.jsdelivr.net/npm/js-dos@8.5.3/dist/js-dos.js";
  const JS_DOS_CSS="https://cdn.jsdelivr.net/npm/js-dos@8.5.3/dist/js-dos.css";
  const FFLATE_URL="https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js";
  const loadedScripts=new Map();
  function loadScript(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);
    const promise = new Promise((resolve,reject)=>{
      const el=document.createElement("script");
      el.src=src;
      el.async=true;
      el.onload=resolve;
      el.onerror=()=>reject(new Error("Failed to load "+src));
      document.head.append(el);
    });
    loadedScripts.set(src,promise);
    return promise;
  }
  function loadStyle(href) {
    return new Promise((resolve,reject)=>{
      const el=document.createElement("link");
      el.rel="stylesheet";el.href=href;
      el.onload=resolve;
      el.onerror=()=>reject(new Error("Failed to load emulator styles"));
      const ownStyle=document.querySelector('link[href^="styles.css"]');
      document.head.insertBefore(el,ownStyle || null);
    });
  }
  async function ensureLibraries() {
    if (libsPromise) return libsPromise;
    libsPromise=Promise.all([
      typeof window.fflate?.unzip==="function"?Promise.resolve():loadScript(FFLATE_URL),
      typeof window.Dos==="function"?Promise.resolve():loadScript(JS_DOS_URL),
      loadStyle(JS_DOS_CSS)
    ]).then(()=>{
      if(typeof window.Dos!=="function" || typeof window.fflate?.unzip!=="function")
        throw new Error("Emulator libraries loaded without their expected APIs.");
    });
    try { await libsPromise; }
    catch(e) { libsPromise=null; throw e; }
  }
  // Startup-only check: ci-ready means DOSBox is alive, but TC.EXE may
  // still be launching. Watch the menu-bar pixels through js-dos's supported
  // screenshot API. This is bounded and never polls during normal editing.
  async function waitForIdeDisplay(ci) {
    if (BGI_SELF_TEST || typeof ci?.screenshot!=="function") return true;
    for (let attempt=0; attempt<8; attempt++) {
      if (!player || commandInterface!==ci) return false;
      try {
        const image=await ci.screenshot();
        if (image?.width>=640 && image?.height>=400 && image.data) {
          // Use the active menu bar's light-grey 4-bit DOS palette. Sampling
          // three positions reduces false positives from a white prompt.
          const greyAt = (x) => {
            const at=(6*image.width+Math.floor(image.width*x))*4;
            const [r,g,b]=image.data.slice(at,at+3);
            return r>=110 && g>=110 && b>=110 && Math.abs(r-g)<28 && Math.abs(g-b)<28;
          };
          if ([0.25,0.39,0.62].filter(greyAt).length>=2) return true;
        }
      } catch(e) { log("Startup screen check unavailable",e.message); return true; }
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    log("IDE startup check inconclusive; DOSBox is ready");
    return true; // Don't strand users if a customized IDE uses another palette.
  }
  async function finishBoot(ci) {
    if(selectedMode!=="dos" && !await waitForIdeDisplay(ci)) return;
    if(commandInterface!==ci || !player) return;
    booting=false;
    setLoadingStep("ready","Turbo C ready");
    setState("running");
    setFocus(false);
    layoutScreen();
    if (safeSetting("turboc:inputTip","show")==="show") setFocusTip(true);
    scheduleMouseReset("emulator ready");
    if(selectedMode==="dos") advanced?.onReady();
    else void refreshFiles();
  }
  async function boot() {
    if(booting || player) return;
    if(disposedOnce) { reloadForFreshEmulator(); return; }
    booting=true;
    setState("loading");
    setLoadingStep("download","Downloading runtime (2.46 MiB)");
    log("Starting Turbo C3");
    try {
      if (location.protocol==="file:") throw new Error("This application requires HTTP or HTTPS, not file://.");
      if (typeof WebAssembly!=="object") throw new Error("WebAssembly is disabled or unsupported.");
      if (selectedMode==="dos") await ensureAdvanced();
      await ensureLibraries();
      const runtime=await prepareInitFs();
      // DOS paths are case-insensitive, but js-dos initFs is backed by a
      // case-sensitive virtual filesystem. Keep the runtime's existing
      // "Projects" spelling: uppercasing the entire path creates a second
      // PROJECTS directory, breaking guest reads and compiler paths.
      const canonicalPath=name=>{
        const raw=(name.includes("/")?name:WORK_DIR+name).replace(/\\/g,"/");
        const parts=raw.split("/");
        if(parts[0]?.toUpperCase()==="TURBOC3") parts[0]="TURBOC3";
        if(parts[1]?.toUpperCase()==="PROJECTS") parts[1]="Projects";
        else if(parts[1]) parts[1]=parts[1].toUpperCase();
        for(let i=2;i<parts.length;i++) parts[i]=parts[i].toUpperCase();
        return parts.join("/");
      };
      const extras=new Map([...savedFiles,...stagedFiles].map(([name,bytes])=>[canonicalPath(name),bytes]));
      const overlayPaths=new Set(extras.keys());
      const initFs=runtime.filter(entry=>!overlayPaths.has(entry.path.toUpperCase()));
      for(const [path,contents] of extras) initFs.push({path,contents});
      log("Workspace sources restored",extras.size+" files");
      workspaceResetPending = false;
      setLoadingStep("boot","Preparing DOS filesystem");
      ui.container.replaceChildren();
      player=window.Dos(ui.container,{
        dosboxConf:selectedMode==="dos"?advanced.getConfig():DOSBOX_CONF,
        initFs,
        pathPrefix:EMULATORS_PATH_PREFIX,
        autoStart:true,
        autoSave:false,
        quickSave:false,
        mouseCapture:false,
        noCursor:false,
        theme:"dark",
        backend:"dosbox",
        backendLocked:true,
        workerThread:typeof SharedArrayBuffer==="function",
        imageRendering:"pixelated",
        renderBackend:"webgl",
        renderAspect:"4/3",
        ...(selectedMode==="dos"?{mouseSensitivity:advanced.getSensitivity()}:{}),
        fsChanges:{local:false},
        onEvent:(event,arg)=>{
          log("js-dos event: "+event);
          if (event==="emu-ready") {
            setLoadingStep("launch",selectedMode==="dos"?"DOSBox initialized · preparing C:\\>":"DOSBox initialized · opening TC.EXE");
            const version=typeof player?.getVersion==="function"?player.getVersion():null;
            if (version) log("js-dos version",version);
          }
          if (event==="ci-ready") {
            commandInterface=arg || null;
            watchVideoMode();
            installDirectMouseInput();
            setLoadingStep("launch",selectedMode==="dos"?"Starting DOS shell…":"Launching Turbo C IDE…");
            void finishBoot(commandInterface);
          }
          if(event==="fullscreen-change") scheduleMouseReset("fullscreen changed");
        }
      });
      if (typeof player.setNoCloud==="function") player.setNoCloud(true);
      if (typeof player.setMouseCapture==="function") player.setMouseCapture(false);
      if (typeof player.setNoCursor==="function") player.setNoCursor(false);
    } catch(e) {
      booting=false;
      log("Startup failed",e?.stack||e.message);
      await stopPlayer({quiet:true,keepError:true});
      showError(e);
    }
  }
  async function stopPlayer({quiet=false,keepError=false}={}) {
    const current=player;
    if(current && commandInterface && !quiet) await saveWorkspace({quiet:true});
    player=null; paused=false; booting=false;
    cleanupMouseRecovery();
    if(current) {
      disposedOnce=true;
      try { await current.stop();if(!quiet) log("Emulator stopped"); }
      catch(e){ log("Stop warning",e.message||String(e)); }
    }
    ui.container.replaceChildren();
    setFocusTip(false);
    if(!keepError) setState("idle");
    layoutScreen();
  }
  function reloadForFreshEmulator() {
    sessionStorage.setItem("turboc:boot-after-reload","1");
    location.reload();
  }
  async function restart() {
    log("Restart requested");
    if(player && !workspaceResetPending && !await saveWorkspace({quiet:true})) {
      announce("Could not save workspace. Download files before restarting.");
      return;
    }
    reloadForFreshEmulator();
  }
  function toggleMouseLock() {
    if (!player || !commandInterface || typeof player.setMouseCapture!=="function") return;
    resetMouse("switching pointer mode");
    mouseLocked=!mouseLocked;
    player.setMouseCapture(mouseLocked);
    if (!mouseLocked && document.pointerLockElement) void document.exitPointerLock();
    ui.mouseLockLabel.textContent=mouseLocked?"Use pointer":"Capture";
    ui.mouseLockBtn.setAttribute("aria-label",mouseLocked?"Use normal pointer":"Capture mouse");
    ui.mouseLockBtn.setAttribute("aria-pressed",String(mouseLocked));
    if (!mouseLocked) scheduleMouseReset("pointer mode restored");
    log("Mouse mode",mouseLocked?"Relative capture":"Direct pointer");
  }
  function installHandlers() {
    ui.retryBtn.addEventListener("click",()=>void boot());
    ui.restartBtn.addEventListener("click",()=>askConfirm(ui.restartBtn,"Restart Turbo C?","Unsaved work in the emulator will be lost. Saved browser source files are kept.",()=>restart()));
    ui.pauseBtn.addEventListener("click",togglePause);
    ui.resumeBtn.addEventListener("click",togglePause);
    ui.stopBtn.addEventListener("click",()=>askConfirm(ui.stopBtn,"Stop emulator?","Unsaved work in the emulator will be lost. Save with F2 first.",()=>stopPlayer()));
    ui.resetMouseBtn.addEventListener("click",()=>void repairMouse());
    ui.mouseLockBtn.addEventListener("click",toggleMouseLock);
    ui.fullscreenBtn.addEventListener("click",toggleFullscreen);
    ui.headerFullscreenBtn.addEventListener("click",toggleFullscreen);
    ui.scaleBtn.addEventListener("click",toggleScale);
    ui.helpBtn.addEventListener("click",()=>openDrawer("help"));
    ui.diagnosticsBtn.addEventListener("click",()=>openDrawer("diagnostics"));
    ui.downloadBtn.addEventListener("click",()=>openDrawer(selectedMode==="dos"?"advancedFiles":"files"));
    ui.themeBtn.addEventListener("click",toggleTheme);
    $("modeTurbo").addEventListener("click",()=>void selectMode("turbo",$("modeTurbo")));
    $("modeDos").addEventListener("click",()=>void selectMode("dos",$("modeDos")));
    $("dosSettingsBtn").addEventListener("click",()=>openDrawer("settings"));
    document.querySelectorAll("[data-dos-command]").forEach(btn=>btn.addEventListener("click",()=>void advanced?.command(btn.dataset.dosCommand)));
    ui.crtToggle.addEventListener("change",()=>{ ui.crtOverlay.hidden=!ui.crtToggle.checked;saveSetting("turboc:crt",String(ui.crtToggle.checked)); });
    ui.drawerBackdrop.addEventListener("click",closeDrawer);
    document.querySelectorAll("[data-close-drawer]").forEach(b=>b.addEventListener("click",closeDrawer));
    ui.cancelConfirmBtn.addEventListener("click",closePopover);
    ui.acceptConfirmBtn.addEventListener("click",()=>{
      const fn=confirmAction;
      closePopover();
      if (fn) void Promise.resolve(fn()).catch(e=>{log("Action failed",e.message);announce("Action failed: "+e.message);});
    });
    document.addEventListener("pointerdown",event=>{
      if (!ui.confirmPopover.hidden && !ui.confirmPopover.contains(event.target) &&
          !event.target.closest("#restartBtn,#stopBtn,#resetWorkspaceBtn")) closePopover();
    },true);
    ui.runDiagnosticsBtn.addEventListener("click",runDiagnostics);
    ui.copyLogBtn.addEventListener("click",()=>void copyText(diagnosticsText()));
    ui.copyErrorBtn.addEventListener("click",()=>void copyText(diagnosticsText()));
    ui.clearLogBtn.addEventListener("click",()=>{ui.log.textContent="";});
    ui.uploadBtn.addEventListener("click",()=>selectedMode==="dos"?advanced?.ui.advancedInput.click():ui.fileInput.click());
    ui.drawerUploadBtn.addEventListener("click",()=>ui.fileInput.click());
    ui.fileInput.addEventListener("change",()=>void uploadFiles(ui.fileInput.files));
    ui.saveWorkspaceBtn.addEventListener("click",()=>void saveWorkspace());
    ui.resetWorkspaceBtn.addEventListener("click",()=>askConfirm(ui.resetWorkspaceBtn,"Reset saved files?","Permanently delete source files stored in this browser? The current DOS session is not changed until restart.",()=>resetSavedWorkspace()));
    ui.refreshFilesBtn.addEventListener("click",()=>void refreshFiles());
    ui.downloadSelectedBtn.addEventListener("click",()=>{if(selectedFile) void downloadSingle(selectedFile);});
    ui.downloadZipBtn.addEventListener("click",()=>void downloadZip());
    ui.dismissTipBtn.addEventListener("click",()=>{setFocusTip(false);saveSetting("turboc:inputTip","hide");});
    window.addEventListener("pointerdown",event=>{
      if (ui.container.contains(event.target) && appState==="running") {
        setFocus(true);
        setFocusTip(false);
        saveSetting("turboc:inputTip","hide");
      }
    },true);
    window.addEventListener("blur",()=>setFocus(false));
    // Guest reads must not race DOS file creation during compile or F2.
    // Saving source copies is explicit (Files > Save locally), not automatic
    // on tab-hide or during an IDE shortcut.
    document.addEventListener("visibilitychange",()=>{
      if (document.hidden) setFocus(false);
    });
    window.addEventListener("keydown",event=>{
      if (event.key==="Tab" && !ui.confirmPopover.hidden) {
        const first=ui.cancelConfirmBtn, last=ui.acceptConfirmBtn;
        if (event.shiftKey && (document.activeElement===first || !ui.confirmPopover.contains(document.activeElement))) {
          event.preventDefault();last.focus();
        } else if (!event.shiftKey && (document.activeElement===last || !ui.confirmPopover.contains(document.activeElement))) {
          event.preventDefault();first.focus();
        }
      }
      if (event.key==="Tab" && activeDrawer && ui.confirmPopover.hidden) {
        const drawer=({help:ui.helpDrawer,files:ui.filesDrawer,diagnostics:ui.diagnosticsPanel,advancedFiles:advanced?.ui.advancedFilesDrawer,settings:advanced?.ui.settingsDrawer})[activeDrawer];
        const focusables=[...drawer.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary')]
          .filter(node=>node.getClientRects().length);
        if (focusables.length) {
          const first=focusables[0], last=focusables[focusables.length-1];
          if (event.shiftKey && (document.activeElement===first || !drawer.contains(document.activeElement))) {
            event.preventDefault();last.focus();
          } else if (!event.shiftKey && (document.activeElement===last || !drawer.contains(document.activeElement))) {
            event.preventDefault();first.focus();
          }
        }
      }
      if(event.key==="Escape" && activeDrawer) {event.stopPropagation();closeDrawer();}
      else if(event.key==="Escape" && !ui.confirmPopover.hidden) {event.stopPropagation();closePopover();}
      else if(event.key==="Escape" && event.shiftKey) {
        event.preventDefault();event.stopImmediatePropagation();
        if(document.pointerLockElement) void document.exitPointerLock();
        ui.helpBtn.focus();setFocus(false);announce("Keyboard returned to page controls.");
      }
    },true);
    document.addEventListener("fullscreenchange",()=>{layoutScreen();scheduleMouseReset("browser fullscreen changed");});
    window.addEventListener("error",event=>{log("Window error",event.message||String(event.error));});
    window.addEventListener("unhandledrejection",event=>{log("Unhandled rejection",event.reason?.message||String(event.reason));});
    window.addEventListener("resize",layoutScreen);
  }
  async function initialize() {
    const theme=safeSetting("turboc:theme","dark");
    document.body.dataset.theme=theme==="classic"?"classic":"dark";
    updateTheme();
    scaleMode=safeSetting("turboc:scale","fit")==="pixel"?"pixel":"fit";
    ui.scaleButtonLabel.textContent=scaleMode==="fit"?"Fit":"Pixel";
    ui.scaleBtn.setAttribute("aria-pressed",String(scaleMode==="pixel"));
    ui.crtToggle.checked=safeSetting("turboc:crt","false")==="true";
    ui.crtOverlay.hidden=!ui.crtToggle.checked;
    ui.app.dataset.state="idle";
    installHandlers();
    setState("loading"); // Keep loading screen during automatic launch.
    layoutScreen();
    log("Turbo C Online IDE initialized");
    if(selectedMode==="dos") {
      try{await ensureAdvanced();}catch(e){selectedMode="turbo";log("Advanced module unavailable",e.message);}
    }
    updateModeUI();
    await loadSavedFiles();
    await refreshFiles();
    try { sessionStorage.removeItem("turboc:boot-after-reload"); } catch {}
    void boot(); // No Start screen or sample chooser.
  }
  void initialize();
})();
