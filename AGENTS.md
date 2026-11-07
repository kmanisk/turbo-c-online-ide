# Turbo C Online IDE — repository instructions

- Static browser application: HTML, CSS, JavaScript, js-dos 8.5.3, and a legacy Turbo C3 runtime.
- Preserve clean-session behavior, classic Turbo C IDE usability, and `graphics.h`/BGI compatibility.
- Keep js-dos and fflate versions pinned unless the task explicitly requires updating them.
- Read `README.md` and inspect `git status --short` before changes.
- Run `node --check app.js`, `git diff --check`, and existing relevant tests.
- Verify mouse clicks across multiple IDE actions: Help > Contents > Escape > File > Open > Escape > Help.
- The bundled Turbo C components are third-party legacy software; review redistribution permissions before public release.
- Do not commit, push, publish, or deploy unless explicitly requested.
