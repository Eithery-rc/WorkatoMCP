# mokutab-extension

The Chrome extension half of [MokuTab](../../README.md). It owns every tool handler, executes requests inside the tab the call targets, and slims the responses before they reach the agent. Module code (Workato is the first) is compiled into the same extension and runs only while the module is switched on.

Built with [WXT](https://wxt.dev) + Vue 3. Manifest V3.

## Build

```bash
pnpm build:shared      # from the repo root: the extension compiles the tool names in
pnpm build:extension
```

Output: `dist/chrome-mv3`. Load it unpacked at `chrome://extensions/`.

The public RSA key pinned in [`wxt.config.ts`](wxt.config.ts) makes the extension ID deterministic, `bpjpdgkeelhkijkllcmogemkmndgeana`, which is what the bridge's native-messaging allowlist expects. A different ID means the build picked up a different key (check `CHROME_EXTENSION_KEY`).

```bash
pnpm dev        # watch mode
pnpm compile    # vue-tsc --noEmit
pnpm test       # vitest
pnpm zip        # packaged build
```

## Layout

```text
entrypoints/
├── background/
│   ├── index.ts               # service-worker entry
│   ├── native-host.ts         # bridge messages, module state push, popup relay
│   ├── extension-module.ts    # ExtensionModule, the module state cache
│   ├── module-popup.ts        # the popup's Modules section handlers
│   ├── tools/
│   │   ├── index.ts           # dispatch: core executors + installed modules
│   │   └── browser/           # core browser tools
│   └── modules/
│       ├── index.ts           # EXTENSION_MODULES
│       └── workato/           # the Workato module
│           ├── index.ts       # executors + afterCall (the context block)
│           ├── content-gate.ts # content scripts run only while the module is on
│           └── tools/
│               ├── workato/            # recipes, jobs, connections, folders,
│               │                       #   tab dispatch, CSRF, response slimming
│               ├── workato-ui/         # live editor automation, save_recipe_code
│               ├── workato-lookup/     # lookup tables
│               ├── workato-lcap/       # Workflow App pages
│               ├── workato-data-table/ # data tables
│               └── workato-session/    # whoami
├── popup/                     # status UI and the Modules switches
├── welcome/                   # first-install onboarding page
├── offscreen/                 # offscreen document (GIF encoder, service-worker keepalive)
├── styles/                    # Tailwind entry and the shared popup/welcome theme
├── element-picker.content.ts  # interactive element selection
└── workato-field-outline.content.ts   # Workato module: optional-fields outline navigator
```

## Writing a handler

Two constraints that are easy to get wrong:

- **In-page functions must be plain, bundler-safe JavaScript.** `chrome.scripting.executeScript` serializes the function before injecting it, so use `function () { ... .then(...) }` rather than `async`/`await`: the bundler rewrites the latter into helpers that don't survive serialization. `pnpm build` runs `check:bundle`, which fails on that shape.
- **Read the Workato CSRF token from the `XSRF-TOKEN-V2` cookie**, inside the in-page function itself, since in-page code cannot import (see the `readCookie` helper in `modules/workato/tools/workato/rename-recipe.ts`, or `getCsrf` in `modules/workato/tools/workato-lookup/handlers.ts`). Recipe editor pages carry no meta tag.

A core tool takes the tab it is given (`tabId`, which the bridge also derives from a lease). A Workato tool resolves its tab through `findWorkatoTab()` in `modules/workato/tools/workato/tab-dispatch.ts`. Never `chrome.tabs.query({active: true})`.

Full conventions: [CONTRIBUTING.md](../../CONTRIBUTING.md). Tool semantics: [docs/TOOLS.md](../../docs/TOOLS.md).
