<div align="center">

<img src="docs/assets/logo.png" alt="WorkatoMCP" width="140" />

# WorkatoMCP

**An MCP server that gives AI agents typed, first-class access to your Workato workspace — through the browser session you are already signed in to.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/workatomcp-bridge?label=workatomcp-bridge)](https://www.npmjs.com/package/workatomcp-bridge)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-compatible-6E56CF)](https://modelcontextprotocol.io)

[Quick start](#quick-start) · [Tool reference](docs/TOOLS.md) · [Architecture](docs/ARCHITECTURE.md) · [Security model](SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

</div>

---

## What it is

WorkatoMCP is a Chrome extension plus a local MCP bridge. It exposes **95 Workato tools** (recipes, jobs, connections, folders and projects, lookup tables, data tables, workflow app pages, and the recipe editor itself) to any MCP client (Claude Code, Claude Desktop, Cursor, and others).

Instead of asking you to mint API tokens, it borrows the authenticated Workato session already open in your browser. Every request goes out from a real Workato tab, with your cookies, your CSRF token, your permissions, and your environment. Nothing is stored, and nothing leaves the machine.

That makes an agent able to do the things a Workato developer actually spends the day on:

```
"Recipe 67992145 has been failing since this morning — find out why and fix it."

→ workato_list_jobs(recipe_id: 67992145, status: "failed")
→ workato_job_trace(recipe_id: 67992145, job_id: 8412…, lines: [104, 118])
→ workato_pull_recipe(recipe_id: 67992145, step: "1616311d")
→ workato_recipe_set_input_path(recipe_id: …, path: "records.custbody_status.refName", value: …)
→ workato_recipe_status(recipe_id: 67992145)   # verify the write landed
```

## Why a browser extension

Workato's public Developer API covers a fraction of what the web app can do — there is no public endpoint for the recipe code tree, job traces, lookup-table CRUD, data tables, or the connector test-action runner. All of it exists behind the same `web_api` endpoints the UI calls.

Piggybacking on the browser session gets you:

- **No API tokens.** Nothing to provision, rotate, leak, or commit.
- **Your exact permissions.** The agent can do what you can do — no more.
- **Multi-region and multi-workspace out of the box.** `app.workato.com`, `app.eu.workato.com`, `*.workato.is`, and custom tenants all work; `workato_switch_profile` moves between Chrome profiles.
- **Read/write parity with the UI.** If you can click it, a tool can usually do it.

## How it works

```mermaid
flowchart LR
    A["MCP client<br/>(Claude Code / Desktop / Cursor)"] -->|streamable HTTP<br/>127.0.0.1:12306/mcp| B["Local bridge<br/>workatomcp-bridge"]
    B <-->|Chrome native messaging| C["Chrome extension<br/>(MV3 service worker)"]
    C -->|in-tab fetch, session cookies| D["Workato tab<br/>app.workato.com"]
    D --> E["Workato web_api"]
```

The bridge is a local Fastify server on `127.0.0.1:12306`. It is launched by Chrome through native messaging on the first tool call — you never start it manually. The extension resolves a signed-in Workato tab, runs the request inside that tab's origin, and returns a slimmed, agent-friendly payload.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full request path, tab resolution rules, and timeout behaviour.

## Highlights

|                                  |                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recipe round-trip**            | Pull the code tree in four views (`full`, `compact`, `outline`, `step`), edit it, push it back with an optimistic version lock. Large recipes stream through a file path so they never hit the model's context.  |
| **Surgical and batch edits**     | Set one nested input path, or apply up to 50 edits including structural ones through a single guarded engine: one pull, one save, one version, with local validation and derived schemas before it writes.       |
| **Job forensics**                | Search jobs by date range or a local match instead of walking pages, with `coverage` on every answer, projected per-step traces that keep `0` and `false`, and erased jobs reported as erased rather than empty. |
| **Any SaaS behind a connection** | `workato_run_query` speaks SOQL, SuiteQL, and SQL through your existing connections. `workato_call_action` invokes any connector action, behind a write-safety gate.                                             |
| **Tables**                       | Full CRUD for both Lookup Tables (12 tools, including upsert and CSV bulk import) and the newer relational Data Tables (12 tools).                                                                               |
| **Bounded reads**                | Projection, exact paths, per-list limits with cursors, a grep that searches a recipe in the browser and returns only the matches, and an auto-file mode that spills an oversized read to disk with a summary.    |
| **Session you can trust**        | A pinned session pins profile, tab, host, workspace and environment together; every response says where it ran, and every write verifies it before acting.                                                       |
| **Workspace management**         | Project and folder trees, create/rename/move/delete, and recipe relocation.                                                                                                                                      |
| **Write safety**                 | Mutating connector actions are refused unless the caller passes `allow_writes: true`. Connection secrets are stripped on every path.                                                                             |
| **Recipe authoring skill**       | A companion [Claude Code skill](#companion-skill) documents Workato's code-tree JSON and its Ruby-allowlist formula language.                                                                                    |

WorkatoMCP also inherits ~32 general browser-automation tools from its upstream project (navigation, snapshots, DOM interaction, network capture, screenshots, console). They are useful when a Workato flow needs UI driving that no endpoint covers.

## Quick start

### Prerequisites

- Node.js 20+
- Google Chrome or Chromium
- A Workato account you can sign into in that browser

### 1. Get the extension

Download `workatomcp-extension-<version>.zip` from the [latest release](https://github.com/Eithery-rc/WorkatoMCP/releases/latest) and unzip it into a folder you will keep, for example `%LOCALAPPDATA%\WorkatoMCP\extension` on Windows. Chrome loads an unpacked extension from that folder on every start, so not your Downloads folder.

GitHub Actions builds the zip from the release tag and attests it. To check a download came from this repository's release workflow:

```bash
gh attestation verify workatomcp-extension-<version>.zip --repo Eithery-rc/WorkatoMCP
```

**From source** (unreleased changes from `master`, or development; needs pnpm 8+):

```bash
git clone https://github.com/Eithery-rc/WorkatoMCP
cd WorkatoMCP
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
npm install -g workatomcp-bridge
```

Postinstall registers the native-messaging host for detected browsers. To verify:

```bash
workatomcp-bridge doctor        # diagnose
workatomcp-bridge doctor --fix  # repair registration
```

### 4. Point your MCP client at it

**Claude Code**

```bash
claude mcp add --transport http workato http://127.0.0.1:12306/mcp
```

**Claude Desktop** (and other clients that spawn a command)

```json
{
  "mcpServers": {
    "workato": {
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
    "workato": {
      "transport": "http",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

Restart the client after editing its config.

### 5. Use it

Open Workato in Chrome, sign in, leave the tab open, and call a tool. The bridge auto-launches on the first request. If a tool returns `WorkatoTabNotFound`, that tab is what's missing.

## Tools

95 Workato tools. Full signatures, parameters, and response shapes are in **[docs/TOOLS.md](docs/TOOLS.md)**.

| Family                                                                               | Count | Prefix                | What it covers                                                                                                      |
| ------------------------------------------------------------------------------------ | ----: | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [Recipes and versions](docs/TOOLS.md#recipes-and-versions)                           |     8 | `workato_`            | Pull the code tree with projection, grep inside it, validate locally, rename, copy, delete, version diff            |
| [Lifecycle, health, operations](docs/TOOLS.md#lifecycle-health-and-long-operations)  |     8 | `workato_`            | Start/stop with a diagnosed failure, status, connection health, callers, journalled multi-recipe saves, test runs   |
| [Jobs](docs/TOOLS.md#jobs)                                                           |     3 | `workato_`            | Search jobs by date range or a local match, projected per-step traces, re-runs                                      |
| [Search and connections](docs/TOOLS.md#search-and-connections)                       |     4 | `workato_`            | Find recipes, steps and connections; inspect a connection (secrets stripped)                                        |
| [Connector execution and discovery](docs/TOOLS.md#connector-execution-and-discovery) |     7 | `workato_`            | Adapter names and field surfaces, pick lists, datapills, queries, the gated action runner, the raw API escape hatch |
| [Projects and folders](docs/TOOLS.md#projects-and-folders)                           |     7 | `workato_`            | Folder tree, folder CRUD, move recipe, project create/update                                                        |
| [Properties](docs/TOOLS.md#properties)                                               |     1 | `workato_`            | List, upsert and delete account (environment) and project properties                                                |
| [Code-side recipe editing](docs/TOOLS.md#code-side-recipe-editing)                   |    10 | `workato_recipe_`     | One guarded engine: batch apply with structural ops, nested inputs, datapills, Python, schemas, callable contracts  |
| [Recipe editor UI](docs/TOOLS.md#recipe-editor-ui)                                   |    11 | `workato_ui_`         | Drive the live editor: open, edit mode, fields, datapills, save, save code tree                                     |
| [Lookup tables](docs/TOOLS.md#lookup-tables)                                         |    12 | `workato_lookup_`     | Table and row CRUD, upsert, search, CSV bulk import                                                                 |
| [Data tables](docs/TOOLS.md#data-tables)                                             |    12 | `workato_data_table_` | Table, column, and record CRUD                                                                                      |
| [Workflow app pages](docs/TOOLS.md#workflow-app-pages)                               |     7 | `workato_lcap_`       | List apps, read, validate, save and patch page trees, create and delete pages                                       |
| [Session and build identity](docs/TOOLS.md#session-and-build-identity)               |     5 | `workato_`            | Which workspace a call lands in, full profile, Chrome profiles, pinning, running build                              |

Plus the inherited [browser tools](docs/TOOLS.md#inherited-browser-tools) (`chrome_*`, `get_windows_and_tabs`, `performance_*`), 127 schemas in total.

**Picking a tool.** The MCP handshake carries a task-to-tool table in the server instructions, so a client with lazy tool discovery gets the routing before it fetches a single schema. The same table, with more detail, is at the top of the [recipe skill](skills/workato-recipes/SKILL.md) and in [docs/TOOLS.md](docs/TOOLS.md). `workato_bridge_info` reports the `tool_count` and `schema_revision` the running build actually serves, which is how to tell a stale install from a documentation error.

## Safety model

WorkatoMCP acts with your Workato identity, so the guardrails matter. In short:

- **Write gate.** `workato_call_action` refuses anything that isn't read-shaped unless the caller explicitly passes `allow_writes: true`.
- **Secret stripping.** Connection configs have secret-shaped keys removed on every response path, including `full: true`.
- **No credential storage.** No tokens, no cookies, no session material is persisted or transmitted anywhere but the local bridge.
- **Local-only surface.** The bridge binds to `127.0.0.1`.
- **Optimistic locking.** Recipe writes can pin `expected_base_version_no` so concurrent edits fail loudly instead of being overwritten.
- **Write verification.** Writes that time out are verified by re-reading state rather than blindly retried.

Full details, threat model, and reporting instructions: [SECURITY.md](SECURITY.md).

## Companion skill

`skills/workato-recipes/` is a Claude Code skill documenting Workato's recipe code-tree JSON (triggers, `foreach`/`if`/`repeat`/`try-catch`, Variables by Workato, app actions) and the complete Ruby-allowlist formula language. It pairs with the `workato_*` tools — the tools mutate the tree, the skill explains what's valid inside it.

Install it as a plugin from this repo's marketplace manifest:

```bash
/plugin marketplace add Eithery-rc/WorkatoMCP
/plugin install workato-recipes@workato-mcp
```

## Repository layout

```text
WorkatoMCP/
├── app/
│   ├── chrome-extension/               # MV3 extension (WXT + Vue 3)
│   │   └── entrypoints/background/tools/
│   │       ├── workato/                # recipes, jobs, connections, folders
│   │       ├── workato-recipe/         # code-side mutators
│   │       ├── workato-ui/             # live editor automation
│   │       ├── workato-lookup/         # lookup tables
│   │       ├── workato-data-table/     # data tables
│   │       ├── workato-session/        # whoami
│   │       └── browser/                # inherited browser automation
│   └── native-server/                  # local bridge on 127.0.0.1:12306
├── packages/
│   └── shared/                         # TOOL_NAMES + TOOL_SCHEMAS (source of truth)
├── skills/workato-recipes/             # recipe authoring reference skill
└── docs/                               # tool reference, architecture, design notes
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

Adding a tool means touching two places: the schema in `packages/shared/src/tools.ts` and the handler under `app/chrome-extension/entrypoints/background/tools/`. Rebuild `shared` before the extension, then call `workato_reload_extension`. It reloads the unpacked extension in every connected profile and restarts the bridge, and the MCP client usually picks up the new schema on its own (only builds older than that tool need one manual reload at `chrome://extensions`).

**Known debt:** `pnpm typecheck` reports around 107 errors, all in code inherited from the upstream project (`record-replay-v3`, `element-marker`, `gif-recorder`). None are in the Workato tool families, and the build is unaffected. CI runs both test suites (extension vitest, bridge jest) and gates on the bridge and shared typechecks, reporting the extension typecheck separately. Details in [docs/ROADMAP.md](docs/ROADMAP.md#known-debt).

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [docs/ROADMAP.md](docs/ROADMAP.md) for what's planned.

## Compatibility

|                 |                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------- |
| Browsers        | Chrome / Chromium (MV3). Firefox builds exist upstream but Workato tools are untested there. |
| Platforms       | Windows, macOS, Linux                                                                        |
| Workato regions | US, EU, JP, SG, AU (`*.workato.com`), plus `*.workato.is` and custom tenants                 |
| MCP transports  | Streamable HTTP (`/mcp`), legacy SSE (`/sse` + `/messages`), stdio (`workatomcp-stdio`)      |

## Credits and license

WorkatoMCP is a fork of [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome), which provides the extension shell, native-messaging bridge, and browser-automation toolkit. The Workato tool families, session model, and safety gates are this fork's own work.

MIT — see [LICENSE](LICENSE) for this fork and [LICENSE.upstream](LICENSE.upstream) for the parent project.

Workato is a trademark of Workato, Inc. This project is not affiliated with or endorsed by Workato.
