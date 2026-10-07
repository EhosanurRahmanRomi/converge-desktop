# Third-party notices

Converge 1.9 uses Electron 44.5.1 and its bundled Chromium runtime. Electron and Chromium license notices are distributed with the Windows application as `LICENSE.electron.txt` and `LICENSES.chromium.html`.

PDF.js 6.4.299 is bundled for local PDF validation under the Apache License 2.0. The license is included in its package and in `licenses/Apache-2.0.txt`. PDF.js optional native canvas dependencies retain their own packaged notices.

The Manrope variable font is bundled from the official Google Fonts repository under the SIL Open Font License 1.1. Its license is included at `renderer/assets/fonts/Manrope-OFL.txt`. Font loading is local and requires no online font service.

The application does not bundle the Codex CLI. Generated code is not executed on the host by the verification lab. Optional container tests use the user's installed Docker and prepared verification image.

Converge is an independent app; it is not an official OpenAI product. Converge's own source remains under the license stated in `package.json`.
