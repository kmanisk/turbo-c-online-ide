# Turbo C Online IDE — Turbo C/C++ with graphics.h (BGI)

Run the classic **Turbo C and Turbo C++ online IDE** in a web browser, with Borland `graphics.h` / BGI support through js-dos, DOSBox, and WebAssembly. No local DOSBox or Turbo C installation is needed to use the browser app.

**Status:** Private development repository. No public site has been deployed from this repository.

**Previous public demo:** https://kmanisk.github.io/TurboC-WebLab/ (the older fork, without this repository's latest mouse-input fix).

## What it does

Turbo C Online IDE runs the legacy Turbo C3 development environment directly in a modern browser. It is aimed at computer-graphics coursework and other older programs that depend on Borland's DOS-era `graphics.h` / BGI stack.

The included runtime was previously verified end-to-end with a real BGI program: `SHOWCASE.C` compiles with Turbo C, links against `GRAPHICS.LIB`, loads `EGAVGA.BGI`, and renders graphics in the browser.

## Verified graphics.h support

The runtime contains and validates:

- `TURBOC3/INCLUDE/GRAPHICS.H`
- `TURBOC3/LIB/GRAPHICS.LIB`
- `TURBOC3/BGI/EGAVGA.BGI`
- the Turbo C compiler/linker toolchain

The included `examples/SHOWCASE.C` draws a rectangle, circle, crosshair lines, and BGI text. The same source is included in the runtime as `C:\TURBOC3\PROJECTS\SHOWCASE.C` and opens automatically when Turbo C starts.

A developer-only automatic verification mode is available at:

```text
http://localhost:8080/?bgi-test=1
```

That mode compiles and runs `SHOWCASE.C` directly through the DOS toolchain, bypassing IDE interaction. It is intended for regression testing rather than normal use.

## Current architecture

```text
Browser
  |
  +-- index.html
  +-- styles.css
  +-- app.js
  |
  +-- fetch same-origin Turboc3.zip (~2.46 MiB)
  +-- fflate async ZIP extraction
  +-- js-dos initFs (~128 files)
  +-- js-dos 8.5.3 / WebAssembly
        |
        +-- Turbo C3 IDE
        +-- graphics.h / GRAPHICS.LIB / BGI drivers
        +-- Projects/SHOWCASE.C
```

The site no longer builds a `.jsdos` bundle in the browser. The old bundle-builder path was unreliable with legacy DOS filenames, so the runtime is unpacked in JavaScript and passed directly to js-dos through `initFs`.

## Runtime optimizations

- js-dos is pinned to **8.5.3** instead of `latest`.
- ZIP extraction uses asynchronous `fflate.unzip()` rather than blocking synchronous extraction.
- Runtime payload is reduced to roughly **2.46 MiB / 128 files**.
- Legacy documentation, class-library samples, compiled sample outputs, and unused demo files are excluded from the browser runtime.
- Runtime downloading begins early when the Start button is hovered or focused.
- WebGL rendering is requested when supported.
- `SharedArrayBuffer` is optional; the app uses js-dos's render-thread fallback when cross-origin isolation is unavailable.

## Clean sessions

The lab intentionally disables js-dos filesystem restore/persistence. Each page load starts from a known clean Turbo C filesystem.

This prevents Turbo C desktop/session state from previous browser runs from reopening old source files or unrelated tabs. It also makes classroom/demo behavior deterministic.

## Controls

Before launch the UI stays minimal: **Start Turbo C3** and **Diagnostics**.

After the emulator starts, the following controls are available:

- Restart
- Pause / Resume
- Fullscreen
- Reset mouse
- Capture mouse / Use pointer
- Stop

### Mouse input after repeated IDE actions

Turbo C can keep moving its pointer while IDE commands stop responding after
the first action (Help, File/Open, Compile, or other actions). The issue is
not necessarily related to BGI or mouse coordinate translation.

js-dos uses an asynchronous CommandInterface between browser events and the
DOSBox worker. Some quick pointerdown/pointerup pairs occur before DOS has
sampled the pressed state. This was reproduced in a real Chromium + js-dos
8.5.3 run: File > Open sometimes dismissed its menu without opening a dialog.

The wrapper now routes absolute input through the js-dos CommandInterface and
keeps a genuine button press held for at least 50 milliseconds before sending
its paired release. It releases genuinely pending presses on cancellation,
browser blur, stop, or a new press, without inserting redundant releases before
every normal click. Coordinates are calculated from the visible canvas
rectangle, and captured/relative mouse mode remains an optional fallback.

A live desktop Chromium run after the timing change successfully opened
File > Open, dismissed its dialog, and opened Help again. This verifies that
sequence on Chromium/Wayland but does not prove compatibility in the ChatGPT
embedded browser or every game/DOS action.

If the problem recurs:
1. Open Diagnostics > Run checks; compare the mouse-down/up counters before
   and after a failed interaction.
2. Use Reset mouse to release buttons and synchronize the pointer.
3. Try Capture mouse for relative input; Use pointer returns to direct mode.

The browser UI smoke test uses a mocked backend and verifies consecutive
clicks, a missing pointer release, canvas replacement, mouse mode switches,
fullscreen and cleanup. Run it with Playwright and Chromium available:

```bash
python3 -m http.server 8765
# In a second terminal:
node tests/mouse-ui-smoke.cjs
```

Test the real IDE in a normal standalone browser as well as any embedded
browser before publishing. No keyboard-menu or compiler-specific auto-repair
is injected.

## Run locally

Serve the repository over HTTP; do not open `index.html` with `file://`.

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Repository layout

```text
.
├── examples/
│   └── SHOWCASE.C
├── Turboc3.zip        # optimized browser runtime
├── app.js             # runtime loader + js-dos controller
├── index.html
└── styles.css
```

js-dos and fflate are loaded from pinned CDN versions; the Turbo C runtime ZIP is served from the same GitHub Pages origin.

## Scope

This is a compatibility environment for legacy Turbo C/C++ and Borland BGI coursework. It is **not** a modern C++ compiler or modern graphics API.

## Project origin

This independent repository retains the development history of
[kmanisk/TurboC-WebLab](https://github.com/kmanisk/TurboC-WebLab),
which originated as a fork of
[CyberCipherSight/TurboC-WebLab](https://github.com/CyberCipherSight/TurboC-WebLab).
It preserves the previous contributions and adds custom runtime, UI, and
mouse-input fixes.

## Redistribution notice

Turbo C/Turbo C++ is legacy third-party software. Verify that you have the legal right to redistribute any included compiler/runtime binaries. The web wrapper and third-party legacy binaries have separate licensing considerations.
