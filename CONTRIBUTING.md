# Contributing

Thanks for your interest in WorkatoMCP. Bug reports, tool contributions, and documentation fixes are all welcome.

## Getting set up

Requirements: Node.js 20+, pnpm 8+, Chrome or Chromium, and a Workato account you can sign into.

```bash
git clone https://github.com/<your-fork>/WorkatoMCP
cd WorkatoMCP
pnpm install
pnpm build:shared      # the extension and bridge both depend on this
pnpm build:extension
```

Load `app/chrome-extension/dist/chrome-mv3` as an unpacked extension and confirm the ID is `bpjpdgkeelhkijkllcmogemkmndgeana`. Install the bridge (`npm install -g workatomcp-bridge`) or run it from `app/native-server` during development.

`pnpm dev` runs watch mode across packages. After any change to `packages/shared`, rebuild it before the extension — the schemas are compiled in.

## Before you open a PR

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm lint`, the tests and `pnpm build` must pass. `pnpm typecheck` currently reports around 107 pre-existing errors in code inherited from the upstream project: see [Known debt](docs/ROADMAP.md#known-debt). Don't add to them. Anything you touch in `packages/shared`, `app/native-server`, or the `tools/workato*` directories must be clean, and CI gates on the first two. `pnpm format` applies Prettier.

**CI runs both test suites.** After Lint, `.github/workflows/ci.yml` runs the extension vitest suite and `pnpm --filter workatomcp-bridge test --coverage=false`. A red test fails the build; the bridge coverage thresholds are deliberately non-gating. Note the flag form: `pnpm --filter workatomcp-bridge test -- --coverage=false` does not work, because pnpm forwards the bare `--` to jest, which reads it as a test-name pattern and exits with "No tests found".

**`pnpm build:extension` now runs `check:bundle`.** The extension's `build` script is `wxt build && npm run check:bundle`, so both `pnpm build` and `pnpm build:extension` run the guard. It fails when the built background script contains a `function _<name>InPage` helper, or an `_asyncToGenerator` wrapper around a function whose name ends in `InPage`, for any name other than the two allowlisted service-worker helpers. That is the shape an `async` in-page function compiles into, and only half of it survives serialization into the tab. `scripts/check-bundle.mjs` takes an optional bundle path as `argv[2]`, and deliberately carries no shebang: with one, vitest fails to parse the module and the whole suite goes red.

Two further gates fire on any new tool: every `'workato_*'` literal in `app/native-server/src/mcp` must exist in `TOOL_NAMES` (a genuine PROVIDER literal such as `workato_pub_sub` goes in the test's `PROVIDER_LITERALS` allowlist instead), and every served description must be under 2048 bytes with no em-dash or en-dash in the Workato families.

## Adding a Workato tool

A tool lives in two places:

1. **Schema** — `packages/shared/src/tools.ts`: a `TOOL_NAMES` entry plus a `TOOL_SCHEMAS` definition.
2. **Handler** — `app/chrome-extension/entrypoints/background/tools/workato*/`, exported from that directory's `index.ts`.

Conventions that keep the tool usable by an agent:

- **The description is the documentation.** It is all the agent sees at call time. State the prerequisites, the response shape, the gotchas, and when to prefer a different tool. Look at `workato_call_action` or `workato_pull_recipe` for the level of detail expected.
- **Slim the response.** Strip schema blocks and UI metadata, truncate long values, and offer `full: true` when the raw payload is genuinely sometimes needed.
- **Resolve the tab through the shared helper.** Never target the focused tab.
- **Route writes through the safety conventions** — verify after a timeout rather than retrying, support `expected_base_version_no` where a version exists, and gate anything destructive behind an explicit flag.
- **Keep secrets out.** If a response can contain credential material, strip it on every path, including `full: true`.
- **Use plain JavaScript in page context.** `chrome.scripting.executeScript` serializes the function, so write `function () { ... .then(...) }` — `async`/`await` gets rewritten by the bundler into helpers that don't survive serialization.
- **Read CSRF from the `XSRF-TOKEN-V2` cookie**, not a meta tag.

### Adding a read tool

A read tool that can return a large result should serve `out_file`, `auto_file` and `auto_file_threshold_chars`. Do not add those three properties to its schema entry: add its name to `READ_TOOLS` in [`app/native-server/src/mcp/workato-auto-file.ts`](app/native-server/src/mcp/workato-auto-file.ts), one line, and `withOutFileToolSchemas` injects them into the served schema. Only add them to `tools.ts` when the wording genuinely has to differ, since the injector fills in a property only when it is absent.

Two things make the summary useful, so keep them true:

- **Emit a parseable JSON payload in the FIRST text block** (plain JSON, or the `summary\nJSON` form). The summary reports `version_no`, top-level keys and depth-1 array counts from it. A tool that returns prose gets a file and an empty `top_level_keys`.
- **Name your continuation field one of the known ones.** Truncation flags are copied verbatim by name: `truncated`, `truncated_fields`, `total_bytes`, `total_items`, `total_count`, `has_more`, `next_page`, `next_cursor`, `limit`, `coverage`, `search_mode`, `warning`. A differently named field needs a line in `TRUNCATION_KEYS`, or the summary will hide the fact that the result is partial.

A tool that answers inside the bridge (an orchestrator, or a local tool such as `workato_operation_status`) returns before the post-processor, so adding it to `READ_TOOLS` would do nothing.

New endpoints discovered by inspecting the Workato UI's network traffic should be recorded in `docs/design/specs/` so the next tool doesn't have to rediscover them, and, when they are worth an agent's attention at authoring time, in [`skills/workato-recipes/platform-endpoints.md`](skills/workato-recipes/platform-endpoints.md).

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — commitlint enforces it via a Husky hook:

```
feat(workato): add workato_repeat_job tool
fix(workato-lookup): pass entry.data to import_csv first_rows
docs: rewrite tool reference
```

Scopes in use: `workato`, `workato-ui`, `workato-recipe`, `workato-lookup`, `workato-data-table`, `workato-session`, `bridge`, `native-server`, `shared`, `popup`, `skill`.

In the PR description, say what you changed, how you verified it, and — for tool changes — paste an actual call and its response. Tools that touch a live Workato workspace can't be covered by unit tests alone, so a smoke test against a real recipe or table is the evidence that counts.

Note that both the extension and the client must be restarted for a schema change to take effect: rebuild, reload the unpacked extension, restart the MCP client.

## Releasing

1. Bump the versions (bridge, shared, extension) and move the `Unreleased` entries in `CHANGELOG.md` under a `## bridge X.Y.Z · shared A.B.C (date)` heading.
2. Commit as `chore(release): ...` and publish the npm packages.
3. Tag that commit with the extension version and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. The release workflow builds the extension, attests the zip and publishes the GitHub release, with the matching `CHANGELOG.md` section as its notes. It fails if the tag disagrees with the extension version.

## Reporting bugs

Open an issue with the bug template. Include:

- `workatomcp-bridge doctor` output (`workatomcp-bridge report --copy` produces a redacted Markdown report)
- The tool call and the error, verbatim
- Your Workato region, and whether the recipe was running at the time

Security issues go through [SECURITY.md](SECURITY.md), not the public tracker.

## Scope

This fork exists to make Workato workspaces operable by AI agents. Improvements to the inherited browser-automation tools are welcome when they serve that goal; larger changes to that layer are usually better contributed to [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) upstream.

By contributing you agree that your work is licensed under the MIT License.
