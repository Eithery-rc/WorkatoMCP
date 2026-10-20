# Contributing

Thanks for your interest in MokuTab. Bug reports, tool contributions, and documentation fixes are all welcome. Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

Requirements: Node.js 20+, pnpm 8+, Chrome or Chromium, and, for the Workato module, a Workato account you can sign into.

```bash
git clone https://github.com/<your-fork>/MokuTab
cd MokuTab
pnpm install
pnpm build:shared      # the extension and bridge both depend on this
pnpm build:extension
```

Load `app/chrome-extension/dist/chrome-mv3` as an unpacked extension and confirm the ID is `bpjpdgkeelhkijkllcmogemkmndgeana`. Install the bridge (`npm install -g @mokuhub/mokutab-bridge`) or run it from `app/native-server` during development.

`pnpm dev` runs watch mode across packages. After any change to `packages/shared`, rebuild it before the extension: the schemas are compiled in.

## Before you open a PR

```bash
pnpm typecheck
pnpm lint
pnpm --filter mokutab-extension test
pnpm --filter @mokuhub/mokutab-bridge test --coverage=false
pnpm build
```

`pnpm lint`, the tests and `pnpm build` must pass. `pnpm typecheck` currently reports 14 pre-existing errors in the extension: see [Known debt](docs/ROADMAP.md#known-debt). Don't add to them. Anything you touch in `packages/shared`, `app/native-server`, or the `modules/workato` directories must be clean, and CI gates on the first two. `pnpm format` applies Prettier.

**CI runs both test suites.** After Lint, `.github/workflows/ci.yml` runs the extension vitest suite and `pnpm --filter @mokuhub/mokutab-bridge test --coverage=false`. A red test fails the build; the bridge coverage thresholds are deliberately non-gating. Note the flag form: `pnpm --filter @mokuhub/mokutab-bridge test -- --coverage=false` does not work, because pnpm forwards the bare `--` to jest, which reads it as a test-name pattern and exits with "No tests found".

**`pnpm build:extension` runs `check:bundle`.** The extension's `build` script is `wxt build && npm run check:bundle`, so both `pnpm build` and `pnpm build:extension` run the guard. It fails when the built background script contains a `function _<name>InPage` helper, or an `_asyncToGenerator` wrapper around a function whose name ends in `InPage`, for any name other than the two allowlisted service-worker helpers. That is the shape an `async` in-page function compiles into, and only half of it survives serialization into the tab. It also fails when any built `.js` file of the extension carries an MCP tool schema (`inputSchema: { type: "object"`): the extension needs tool names only, and a top-level spread over the schemas in `packages/shared`, or reading `.id` off an object that holds them, ships all of them (about 300 KB) into the service worker and the popup. `scripts/check-bundle.mjs` takes an optional bundle path as `argv[2]`, and deliberately carries no shebang: with one, vitest fails to parse the module and the whole suite goes red.

Further gates fire on any new tool:

- **Module boundary.** Core never imports a module, and one module never imports another. `app/native-server/src/module-boundary.test.ts` (which also scans the shared package) and `app/chrome-extension/tests/module-boundary.test.ts` fail on such an import.
- **Tool name drift.** Core bridge sources name no `workato_*` tool at all (`app/native-server/src/mcp/tool-name-drift.test.ts`). In the Workato module, every `'workato_*'` literal must be a tool the module serves (`app/native-server/src/modules/workato/tool-name-drift.test.ts`); a genuine PROVIDER literal such as `workato_pub_sub` goes in that test's `PROVIDER_LITERALS` allowlist instead.
- **Descriptions.** Every served description must be under 2048 bytes, with no em-dash or en-dash in the Workato families, and the server instructions stay under the 2 KB budget for every combination of modules on and off.

## Adding a tool

A tool lives in two places:

1. **Schema.** A core tool in `packages/shared/src/tools.ts` (`CORE_TOOL_NAMES` plus a `CORE_TOOL_SCHEMAS` entry); a Workato tool in `packages/shared/src/modules/workato/` (`tool-names.ts` and `schemas.ts`).
2. **Handler.** A core tool under `app/chrome-extension/entrypoints/background/tools/browser/`; a Workato tool in the matching `entrypoints/background/modules/workato/tools/workato*/` directory, exported from that directory's `index.ts`. A Workato tool that runs in the bridge goes through the module's `handle` hook in `app/native-server/src/modules/workato/`.

Conventions that keep the tool usable by an agent:

- **The description is the documentation.** It is all the agent sees at call time. State the prerequisites, the response shape, the gotchas, and when to prefer a different tool. Look at `workato_call_action` or `chrome_snapshot` for the level of detail expected.
- **Slim the response.** Strip schema blocks and UI metadata, truncate long values, and offer `full: true` when the raw payload is genuinely sometimes needed.
- **Resolve the tab explicitly.** Never target the focused tab: a core tool takes `tabId` (or the lease the bridge turns into one), a Workato tool resolves through `findWorkatoTab()`.
- **Route writes through the safety conventions:** verify after a timeout rather than retrying, support `expected_base_version_no` where a version exists, and gate anything destructive behind an explicit flag.
- **Keep secrets out.** If a response can contain credential material, strip it on every path, including `full: true`.
- **Use plain JavaScript in page context.** `chrome.scripting.executeScript` serializes the function, so write `function () { ... .then(...) }`: `async`/`await` gets rewritten by the bundler into helpers that don't survive serialization.
- **Read the Workato CSRF token from the `XSRF-TOKEN-V2` cookie**, not a meta tag.

### Adding a read tool

A read tool that can return a large result should serve `out_file`, `auto_file` and `auto_file_threshold_chars`. Do not add those three properties to its schema entry: add its name to its read-tool set, one line, and `withOutFileToolSchemas` injects them into the served schema. Core read tools are `CORE_READ_TOOLS` in [`app/native-server/src/mcp/auto-file.ts`](app/native-server/src/mcp/auto-file.ts); Workato read tools are `WORKATO_READ_TOOLS` in [`app/native-server/src/modules/workato/index.ts`](app/native-server/src/modules/workato/index.ts). Only add the properties to the schema when the wording genuinely has to differ, since the injector fills in a property only when it is absent.

Two things make the summary useful, so keep them true:

- **Emit a parseable JSON payload in the FIRST text block** (plain JSON, or the `summary\nJSON` form). The summary reports `version_no`, top-level keys and depth-1 array counts from it. A tool that returns prose gets a file and an empty `top_level_keys`.
- **Name your continuation field one of the known ones.** Truncation flags are copied verbatim by name: `truncated`, `truncated_fields`, `total_bytes`, `total_items`, `total_count`, `has_more`, `next_page`, `next_cursor`, `limit`, `coverage`, `search_mode`, `warning`. A differently named field needs a line in `TRUNCATION_KEYS`, or the summary will hide the fact that the result is partial.

A tool that answers inside the bridge (an orchestrator, or a local tool such as `workato_operation_status`) returns before the post-processor, so adding it to a read-tool set would do nothing.

New Workato endpoints discovered by inspecting the UI's network traffic should be recorded in `docs/design/specs/` so the next tool doesn't have to rediscover them, and, when they are worth an agent's attention at authoring time, in [`skills/workato-recipes/platform-endpoints.md`](skills/workato-recipes/platform-endpoints.md).

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/); commitlint enforces it via a Husky hook:

```
feat(workato): add workato_repeat_job tool
fix(bridge): refuse a websocket at the upgrade
docs: rewrite tool reference
```

Scopes in use: `bridge`, `extension`, `shared`, `browser`, `workato`, `recipes`, `jobs`, `lcap`, `popup`, `skill`, `deps`, `release`.

In the PR description, say what you changed, how you verified it, and, for tool changes, paste an actual call and its response. Tools that touch a live page or a live Workato workspace can't be covered by unit tests alone, so a smoke test against a real page, recipe or table is the evidence that counts.

A schema change takes effect after a rebuild, `chrome_reload_extension` (or a manual reload of the unpacked extension), and, when the client does not pick it up, a restart of the MCP client.

## Releasing

1. Bump the versions (bridge, shared, extension) and move the `Unreleased` entries in `CHANGELOG.md` under a `## bridge X.Y.Z · shared A.B.C (date)` heading.
2. Commit as `chore(release): ...` and publish the npm packages.
3. Tag that commit with the extension version and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. The release workflow builds the extension, attests the zip and publishes the GitHub release, with the matching `CHANGELOG.md` section (the one whose heading starts with `## bridge X.Y.Z `) as its notes. It fails if the tag disagrees with the extension version.

## Reporting bugs

Open an issue with the bug template. Include:

- `mokutab-bridge doctor` output (`mokutab-bridge report --copy` produces a redacted Markdown report)
- The tool call and the error, verbatim
- Which modules are on, and for Workato, your region and whether the recipe was running at the time

Security issues go through [SECURITY.md](SECURITY.md), not the public tracker.

## Scope

MokuTab exists to give AI agents the user's own logged-in browser, plus modules for products that deserve a typed tool family of their own (Workato is the first). It is developed independently of the project it started from, so the inherited browser-automation tools are maintained here too, and changes to them are welcome when they serve that goal.

By contributing you agree that your work is licensed under the MIT License.
