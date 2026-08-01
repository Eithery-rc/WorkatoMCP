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
pnpm build
```

All three must pass; CI runs the same commands. `pnpm format` applies Prettier.

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

New endpoints discovered by inspecting the Workato UI's network traffic should be recorded in `docs/design/specs/` so the next tool doesn't have to rediscover them.

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

## Reporting bugs

Open an issue with the bug template. Include:

- `workatomcp-bridge doctor` output (`workatomcp-bridge report --copy` produces a redacted Markdown report)
- The tool call and the error, verbatim
- Your Workato region, and whether the recipe was running at the time

Security issues go through [SECURITY.md](SECURITY.md), not the public tracker.

## Scope

This fork exists to make Workato workspaces operable by AI agents. Improvements to the inherited browser-automation tools are welcome when they serve that goal; larger changes to that layer are usually better contributed to [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) upstream.

By contributing you agree that your work is licensed under the MIT License.
