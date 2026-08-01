# workatomcp-extension

The Chrome extension half of [WorkatoMCP](../../README.md). It owns every tool handler, resolves the Workato tab, executes requests inside that tab's authenticated session, and slims the responses before they reach the agent.

Built with [WXT](https://wxt.dev) + Vue 3. Manifest V3.

## Build

```bash
pnpm build:shared      # from the repo root — the extension compiles the schemas in
pnpm build:extension
```

Output: `dist/chrome-mv3`. Load it unpacked at `chrome://extensions/`.

The public RSA key pinned in [`wxt.config.ts`](wxt.config.ts) makes the extension ID deterministic — `bpjpdgkeelhkijkllcmogemkmndgeana` — which is what the bridge's native-messaging allowlist expects. A different ID means the build picked up a different key (check `CHROME_EXTENSION_KEY`).

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
│   ├── native-host.ts         # bridge message listener
│   └── tools/
│       ├── workato/           # recipes, jobs, connections, folders,
│       │                      #   tab dispatch, CSRF, response slimming
│       ├── workato-recipe/    # code-tree mutators (pull → mutate → push)
│       ├── workato-ui/        # live editor automation, save_recipe_code
│       ├── workato-lookup/    # lookup tables
│       ├── workato-data-table/# data tables
│       ├── workato-session/   # whoami
│       └── browser/           # inherited browser automation
├── popup/                     # status UI
├── options/                   # settings
├── welcome/                   # first-install onboarding page
├── offscreen/                 # offscreen document
├── content.ts                 # main content script
├── element-picker.content.ts  # interactive element selection
└── workato-field-outline.content.ts   # optional-fields outline navigator
```

## Writing a handler

Two constraints that are easy to get wrong:

- **In-page functions must be plain, bundler-safe JavaScript.** `chrome.scripting.executeScript` serializes the function before injecting it, so use `function () { ... .then(...) }` rather than `async`/`await` — the bundler rewrites the latter into helpers that don't survive serialization.
- **Read the CSRF token from the `XSRF-TOKEN-V2` cookie** (see `tools/workato/csrf.ts`). Recipe editor pages carry no meta tag.

Resolve the target tab through `findWorkatoTab()` in `tools/workato/tab-dispatch.ts` — never `chrome.tabs.query({active: true})`.

Full conventions: [CONTRIBUTING.md](../../CONTRIBUTING.md). Tool semantics: [docs/TOOLS.md](../../docs/TOOLS.md).
