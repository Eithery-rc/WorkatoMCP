<div align="center">

<img src="docs/assets/logo.png" alt="MokuTab" width="140" />

# MokuTab

**Browser tools for AI agents that drive your own logged-in Chrome. A MokuHub product.**

[![CI](https://github.com/MokuHub/MokuTab/actions/workflows/ci.yml/badge.svg)](https://github.com/MokuHub/MokuTab/actions/workflows/ci.yml)
[![Extension release](https://img.shields.io/github/v/release/MokuHub/MokuTab?label=extension)](https://github.com/MokuHub/MokuTab/releases/latest)
[![npm](https://img.shields.io/npm/v/@mokuhub/mokutab-bridge?label=%40mokuhub%2Fmokutab-bridge)](https://www.npmjs.com/package/@mokuhub/mokutab-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-compatible-6E56CF)](https://modelcontextprotocol.io)

[Quick start](#quick-start) · [Tool reference](docs/TOOLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Security model](SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Upgrade from WorkatoMCP 1.x](#upgrade-from-workatomcp-1x)

</div>

---

## What it is

MokuTab is a Chrome extension plus a local MCP bridge. It gives any MCP client (Claude Code, Claude Desktop, Cursor and others) tools that act in the Chrome you already use: your profiles, your tabs, your signed-in sessions. An agent reads a page, clicks and fills, captures network traffic, downloads a file, runs a saved browser flow by name, or sleeps until a page changes.

There are no API tokens to mint and no second browser to log in to. Every request goes out from a real tab with your cookies and your permissions. The bridge listens on `127.0.0.1` only, and nothing leaves the machine.

```
"Open the support case in the client portal and tell me what changed since yesterday."

→ chrome_lease_tab(url: "https://portal.example.com/cases/4412")
→ chrome_snapshot(lease: "L1")
→ chrome_get_web_content(lease: "L1", textContent: true)
→ chrome_release_tab(lease: "L1")
```

On top of the core, **modules** add tool families for one product. Workato is the first.

## Core tools

52 tools, always on. Full signatures are in [docs/TOOLS.md](docs/TOOLS.md#core).

| Area                    | Tools                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabs and navigation     | `get_windows_and_tabs`, `chrome_navigate`, `chrome_switch_tab`, `chrome_close_tabs`                                                                                     |
| Snapshots and actions   | `chrome_snapshot`, `chrome_snapshot_click`, `chrome_snapshot_fill`, `chrome_snapshot_fill_form`, `chrome_snapshot_hover`, `chrome_snapshot_wait_for`, `chrome_act`      |
| Reading the page        | `chrome_read_page`, `chrome_get_web_content`, `chrome_search_page`, `chrome_find_elements`, `chrome_javascript`, `chrome_console`                                       |
| Input                   | `chrome_click_element`, `chrome_fill_or_select`, `chrome_keyboard`, `chrome_computer`, `chrome_upload_file`, `chrome_handle_dialog`, `chrome_request_element_selection` |
| Network and files       | `chrome_network_request`, `chrome_network_capture`, `chrome_fetch_to_file`, `chrome_handle_download`                                                                    |
| Capture and performance | `chrome_screenshot`, `chrome_gif_recorder`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`                                          |
| History and bookmarks   | `chrome_history`, `chrome_bookmark_search`, `chrome_bookmark_add`, `chrome_bookmark_delete`                                                                             |
| Parallel agents         | `chrome_lease_tab`, `chrome_release_tab`                                                                                                                                |
| Watches                 | `chrome_watch_start`, `chrome_watch_stop`, `chrome_watch_list`, `chrome_watch_events`                                                                                   |
| Browser functions       | `chrome_fn_list`, `chrome_fn_get`, `chrome_fn_run`, `chrome_fn_save`, `chrome_fn_runs`                                                                                  |
| Profiles and build      | `chrome_list_profiles`, `chrome_switch_profile`, `chrome_bridge_info`, `chrome_reload_extension`                                                                        |

What the core is built around:

- **Your own session.** One bridge serves every Chrome profile on the machine. `chrome_switch_profile` routes a session to a profile and pins a tab.
- **Parallel agents.** Each agent leases its own tab and passes the lease on every call, so several agents share one MCP server without stepping on each other's tabs.
- **Actions that report what they did.** Clicks, fills and navigations wait for the page to settle and report the URL it landed on, a dialog it opened, and the tabs it opened.
- **Saved browser functions.** A flow written once (open a page, wait, run JS, check, commit) is saved as a versioned YAML file in a private git registry and run by name. Logins can type values from your Bitwarden vault without any model seeing them.
- **Watches.** An agent waits on a CLI that long-polls the bridge until a page changes, so a quiet page costs no tokens.
- **Large results go to files.** An oversized read spills to a file with a summary; `chrome_fetch_to_file` writes a PDF or CSV export to disk byte for byte.

## Modules

A module is a tool family for one product, compiled into the same extension and switched on per machine.

- **The switch.** The extension popup has a **Modules** section with one switch per module. It is one switch per machine, kept by the bridge in `~/.mokutab/config.json`, so every Chrome profile shows and changes the same value. With no bridge connected the switch is disabled.
- **Defaults.** A fresh install starts with every module off. An upgrade from 1.x keeps Workato on.
- **While a module is off**, `tools/list` leaves its tools out, the server instructions say it is off, and a call to one of its tools is refused with the module name and "turn it on in the MokuTab popup", never "Tool not found".
- **Live sessions.** A change sends `notifications/tools/list_changed` to every open MCP session. A client that ignores it sees the change in its next session.

### Workato

97 tools for Workato: recipes, jobs, connections, folders and projects, lookup tables, data tables, Workflow App pages, deployments and the recipe editor itself. Switch it on in the popup, sign in to Workato in Chrome, and leave a Workato tab open.

Workato's public Developer API covers a fraction of what the web app does: there is no public endpoint for the recipe code tree, job traces, lookup-table CRUD, data tables or the connector test-action runner. The module calls the same `web_api` endpoints the UI calls, from inside a signed-in Workato tab, with your cookies, your CSRF token, your permissions and your environment.

```
"Recipe 67992145 has been failing since this morning. Find out why and fix it."

→ workato_list_jobs(recipe_id: 67992145, status: "failed")
→ workato_job_trace(recipe_id: 67992145, job_id: 8412…, lines: [104, 118])
→ workato_pull_recipe(recipe_id: 67992145, step: "1616311d")
→ workato_recipe_set_input_path(recipe_id: …, path: "records.custbody_status.refName", value: …)
→ workato_recipe_status(recipe_id: 67992145)   # verify the write landed
```

| Family                                                                               | Count | Prefix                | What it covers                                                                                                     |
| ------------------------------------------------------------------------------------ | ----: | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Recipes and versions](docs/TOOLS.md#recipes-and-versions)                           |     8 | `workato_`            | Pull the code tree with projection, grep inside it, validate locally, rename, copy, delete, version diff           |
| [Lifecycle, health, operations](docs/TOOLS.md#lifecycle-health-and-long-operations)  |     8 | `workato_`            | Start/stop with a diagnosed failure, status, connection health, callers, journalled multi-recipe saves, test runs  |
| [Jobs](docs/TOOLS.md#jobs)                                                           |     3 | `workato_`            | Search jobs by date range or a local match, projected per-step traces, re-runs                                     |
| [Search and connections](docs/TOOLS.md#search-and-connections)                       |     4 | `workato_`            | Find recipes, steps and connections; inspect a connection (secrets stripped)                                       |
| [Connector execution and discovery](docs/TOOLS.md#connector-execution-and-discovery) |     8 | `workato_`            | Adapter names and field surfaces, pick lists, step schemas, datapills, queries, the gated action runner, raw API   |
| [Projects, folders and deployments](docs/TOOLS.md#projects-and-folders)              |    10 | `workato_`            | Folder tree, folder CRUD, move recipe, project create/update, deployment history, plan and run                     |
| [Properties](docs/TOOLS.md#properties)                                               |     1 | `workato_`            | List, upsert and delete account (environment) and project properties                                               |
| [Code-side recipe editing](docs/TOOLS.md#code-side-recipe-editing)                   |    10 | `workato_recipe_`     | One guarded engine: batch apply with structural ops, nested inputs, datapills, Python, schemas, callable contracts |
| [Recipe editor UI](docs/TOOLS.md#recipe-editor-ui)                                   |    11 | `workato_ui_`         | Drive the live editor: open, edit mode, fields, datapills, save, save code tree                                    |
| [Lookup tables](docs/TOOLS.md#lookup-tables)                                         |    12 | `workato_lookup_`     | Table and row CRUD, upsert, search, CSV bulk import                                                                |
| [Data tables](docs/TOOLS.md#data-tables)                                             |    12 | `workato_data_table_` | Table, column, and record CRUD                                                                                     |
| [Workflow app pages](docs/TOOLS.md#workflow-app-pages)                               |     7 | `workato_lcap_`       | List apps, read, validate, save and patch page trees, create and delete pages                                      |
| [Session and environment](docs/TOOLS.md#session-and-environment)                     |     3 | `workato_`            | Which workspace a call lands in, the full profile, switching environment or client workspace                       |

What the module adds on top of the core:

- **Recipe round-trip.** Pull the code tree in four views (`full`, `compact`, `outline`, `step`), edit it, push it back with an optimistic version lock. Large recipes go through a file path and never enter the model's context.
- **Surgical and batch edits.** Set one nested input path, or apply up to 50 edits, structural ones included, through one guarded engine: one pull, one save, one version, validated locally with derived schemas before it writes.
- **Job forensics.** Search jobs by date range or a local match instead of walking pages, with `coverage` on every answer, and erased jobs reported as erased rather than empty.
- **Any SaaS behind a connection.** `workato_run_query` speaks SOQL, SuiteQL and SQL through your existing connections; `workato_call_action` invokes any connector action behind a write gate.
- **A pin you can trust.** A pinned session pins profile, tab, host, workspace and environment together; every Workato response says where it ran, and every write checks it first.

The [workato-recipes skill](#companion-skill) documents the code-tree JSON and the formula language the tools write.

## Quick start

### Prerequisites

- Node.js 20+
- Google Chrome or Chromium
- For the Workato module: a Workato account you can sign into in that browser

### 1. Get the extension

Download `mokutab-extension-<version>.zip` from the [latest release](https://github.com/MokuHub/MokuTab/releases/latest) and unzip it into a folder you will keep, for example `%LOCALAPPDATA%\MokuTab\extension` on Windows. Chrome loads an unpacked extension from that folder on every start, so not your Downloads folder.

GitHub Actions builds the zip from the release tag and attests it. To check a download came from this repository's release workflow:

```bash
gh attestation verify mokutab-extension-<version>.zip --repo MokuHub/MokuTab
```

**From source** (unreleased changes from `master`, or development; needs pnpm 8+):

```bash
git clone https://github.com/MokuHub/MokuTab
cd MokuTab
pnpm install
pnpm build:shared
pnpm build:extension
```

The unpacked extension lands in `app/chrome-extension/dist/chrome-mv3`.

The extension's public RSA key is pinned in `app/chrome-extension/wxt.config.ts`, so the release zip and every clone build to the same extension ID, `bpjpdgkeelhkijkllcmogemkmndgeana`, which is what the bridge's native-messaging allowlist expects.

### 2. Load it in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. **Load unpacked** → select the folder you unzipped into (or `app/chrome-extension/dist/chrome-mv3` for a source build)
4. Confirm the ID reads `bpjpdgkeelhkijkllcmogemkmndgeana`

If a source build shows a different ID, delete `app/chrome-extension/dist/` and `app/chrome-extension/.wxt/`, then rebuild, and check that `CHROME_EXTENSION_KEY` isn't overriding the pinned key.

To update, replace the folder's contents with the new release zip and press reload on the extension card. Keep the extension and the bridge on the same release: each release names the bridge version it pairs with.

### 3. Install the bridge

```bash
npm install -g @mokuhub/mokutab-bridge
```

Postinstall registers the native-messaging host for detected browsers. To verify:

```bash
mokutab-bridge doctor        # diagnose
mokutab-bridge doctor --fix  # repair registration
```

Upgrading from 1.x? Follow [the upgrade steps](#upgrade-from-workatomcp-1x) instead: the old package has to be removed first.

### 4. Register it in your MCP client

**Claude Code**, under the key `mokutab`:

```bash
claude mcp add --transport http -s user mokutab http://127.0.0.1:12306/mcp
```

Tools then read `mcp__mokutab__chrome_snapshot`, `mcp__mokutab__workato_pull_recipe` and so on.

**Claude Desktop** (and other clients that spawn a command)

```json
{
  "mcpServers": {
    "mokutab": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:12306/mcp", "--allow-http"]
    }
  }
}
```

**Clients with native streamable-HTTP support**

```json
{
  "mcpServers": {
    "mokutab": {
      "transport": "http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

Restart the client after editing its config.

### 5. Use it

Call a tool. The bridge starts through native messaging on the first request; you never start it by hand. To use the Workato module, turn on **Workato** under **Modules** in the extension popup, sign in to Workato in Chrome and leave the tab open. If a Workato tool returns `TabNotFound`, that tab is what's missing.

## Manual smoke test

After an install or an upgrade, from a new MCP client session:

1. `mokutab-bridge doctor` reports no failures, and the extension popup says the service is running.
2. `chrome_bridge_info()` returns the bridge version and `tool_count`: 52 with Workato off, 153 with it on (52 core, 97 Workato, and the four old tool names kept until 3.0).
3. `chrome_lease_tab(url: "https://example.com")` returns a `lease`. `chrome_snapshot(lease: <it>)` lists the page's heading and its link, each with a `[uid=N]` marker. `chrome_release_tab(lease: <it>)` closes the tab.
4. With Workato on and a signed-in Workato tab open: `workato_session_context()` names the workspace and environment, and `workato_pull_recipe(recipe_id: <any recipe>, view: "outline")` returns a positive `version_no`.
5. Switch Workato off in the popup and start a new session: `tools/list` has 52 tools, and a `workato_*` call is refused with "Turn it on in the MokuTab popup (Modules)". Switch it back on if you use it.

## Upgrade from WorkatoMCP 1.x

WorkatoMCP 1.x is now MokuTab. Same extension ID, same native host, new package, new data dir and a new registration key. Upgrade in this order:

1. **Quit Chrome completely**, every profile. The running native host locks the old package's files on Windows.
2. **Remove the old package:** `npm uninstall -g workatomcp-bridge`. It must come before the install: the new package keeps the old command names (`workatomcp-bridge`, `workatomcp-stdio`, `mcp-chrome-bridge`, `chrome-mcp-bridge`, `mcp-chrome-stdio`) as aliases until 3.0, so installing over the old package fails with `EEXIST`. `--force` is not a workaround: a later uninstall of the old package deletes the shared command names.
3. **Install the new one:** `npm i -g @mokuhub/mokutab-bridge`. Postinstall registers the native host under the same id.
4. **Put the 2.0.0 extension in place:** unzip the release zip over the folder Chrome loads the extension from, or rebuild the repo (`app/chrome-extension/dist/chrome-mv3`). It has the same extension ID, so it replaces the old one in place and keeps its permissions, including the userScripts toggle.
5. **Start Chrome.** The first bridge start moves `~/.workatomcp` to `~/.mokutab`. If something holds that directory open, the move is retried at the next start; `mokutab-bridge doctor` says whether it happened.
6. **Re-register in Claude Code:** `claude mcp add --transport http -s user mokutab http://127.0.0.1:12306/mcp`, then `claude mcp remove workato -s user`, then restart the sessions. The old names of the four renamed tools (`workato_list_profiles`, `workato_switch_profile`, `workato_bridge_info`, `workato_reload_extension`) keep working until 3.0 while Workato is on. Permission allowlists that name `mcp__workato__*` need the new prefix `mcp__mokutab__*`.
7. **Check:** `mokutab-bridge doctor`. It flags what 1.x left behind: the old package, a native host manifest pointing into it, a Claude Code registration still under `workato` (user or project scope, with the command that removes it), and a data dir that has not moved.

Workato stays on after an upgrade: a machine where `~/.workatomcp` or the 1.x bridge state dir exists counts as one. Switch it off in the popup if you do not need it.

## Safety model

MokuTab acts with your browser identity, so the guardrails matter. In short:

- **Local-only surface.** The bridge binds to `127.0.0.1`, refuses foreign origins and hosts on every route, and accepts only this extension's ID.
- **No credential storage.** No tokens, cookies or session material are persisted or sent anywhere but between the extension and the local bridge.
- **Output redaction.** Cookie strings, tokens and secret-shaped fields are redacted from page results; vault values typed by a browser function are scrubbed from everything it returns.
- **Commits are explicit.** A browser function that writes or sends returns a preview first and commits only on `confirm`.
- **Workato write gate.** `workato_call_action` refuses anything that isn't read-shaped unless the caller passes `allow_writes: true`, and connection configs have secret-shaped keys removed on every path, including `full: true`.
- **Optimistic locking and write verification.** Recipe writes can pin `expected_base_version_no`; writes that time out are verified by re-reading state, never blindly retried.

Full details, threat model, and reporting instructions: [SECURITY.md](SECURITY.md).

## Companion skill

`skills/workato-recipes/` is a Claude Code skill documenting Workato's recipe code-tree JSON (triggers, `foreach`/`if`/`repeat`/`try-catch`, Variables by Workato, app actions), the complete Ruby-allowlist formula language and the Workflow App page format. It pairs with the Workato module: the tools mutate the tree, the skill explains what's valid inside it.

Install it as a plugin from this repo's marketplace manifest:

```bash
/plugin marketplace add MokuHub/MokuTab
/plugin install workato-recipes@workato-mcp
```

## Repository layout

```text
MokuTab/
├── app/
│   ├── chrome-extension/                    # MV3 extension (WXT + Vue 3)
│   │   └── entrypoints/background/
│   │       ├── tools/browser/               # core browser tools
│   │       └── modules/workato/             # Workato module: executors, context block, content-script gate
│   └── native-server/                       # local bridge on 127.0.0.1:12306
│       └── src/
│           ├── mcp/                         # router, module switch, leases, watches, browser functions
│           └── modules/workato/             # Workato orchestrators, recipe engine, operations journal
├── packages/
│   └── shared/                              # tool names and schemas (source of truth)
│       └── src/modules/workato/             # Workato tool names, schemas, instructions snippet
├── skills/workato-recipes/                  # recipe authoring reference skill
└── docs/                                    # tool reference, architecture, design notes
```

## Development

```bash
pnpm install
pnpm build          # shared → bridge → extension
pnpm dev            # watch mode across packages
pnpm typecheck      # tsc --noEmit everywhere (see Known debt below)
pnpm lint           # eslint
pnpm format         # prettier
```

Adding a tool means touching two places: the schema (core in `packages/shared/src/tools.ts`, Workato in `packages/shared/src/modules/workato/`) and the handler (core under `app/chrome-extension/entrypoints/background/tools/browser/`, Workato under `entrypoints/background/modules/workato/tools/`). Rebuild `shared` before the extension, then call `chrome_reload_extension`. It reloads the unpacked extension in every connected profile and restarts the bridge, and the MCP client usually picks up the new schema on its own.

**Known debt:** `pnpm typecheck` reports 14 errors in the extension: five in inherited browser code (`gif-recorder`, the offscreen GIF encoder and keepalive, network capture), one in `workato/properties.ts` and eight in two Workato test files. The build is unaffected. CI runs both test suites (extension vitest, bridge jest) and gates on the bridge and shared typechecks, reporting the extension typecheck separately. Details in [docs/ROADMAP.md](docs/ROADMAP.md#known-debt).

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [docs/ROADMAP.md](docs/ROADMAP.md) for what's planned.

## Compatibility

|                 |                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- |
| Browsers        | Chrome / Chromium (MV3). A Firefox build target exists (`build:firefox`) but is untested. |
| Platforms       | Windows, macOS, Linux                                                                     |
| Workato regions | US, EU, JP, SG, AU (`*.workato.com`), plus `*.workato.is` and custom tenants              |
| MCP transports  | Streamable HTTP (`/mcp`), legacy SSE (`/sse` + `/messages`), stdio (`mokutab-stdio`)      |

## Credits and license

MokuTab is written by Roman Chikalenko and published by MokuHub LLC. It started as a fork of [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome), which provided the extension shell, native-messaging bridge, and browser-automation toolkit, and is now developed independently. The module system, tab leases, watches, browser functions, the Workato module, its session model and the safety gates are its own work.

MIT, copyright MokuHub LLC. See [LICENSE](LICENSE) for this project and [LICENSE.upstream](LICENSE.upstream) for the project it started from.

Workato is a trademark of Workato, Inc. This project is not affiliated with or endorsed by Workato.
