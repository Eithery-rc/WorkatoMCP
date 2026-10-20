# Troubleshooting

Start here:

```bash
mokutab-bridge doctor        # diagnose registration, ports, permissions, 1.x leftovers
mokutab-bridge doctor --fix  # repair what it can
```

If you need to file an issue, attach a redacted diagnostic report:

```bash
mokutab-bridge report --copy   # Markdown report, secrets redacted, on the clipboard
```

The bridge's wrapper logs are in `%LOCALAPPDATA%\mokutab-bridge\logs` on Windows, `~/Library/Logs/mokutab-bridge` on macOS and `$XDG_STATE_HOME/mokutab-bridge/logs` (or `~/.local/state/mokutab-bridge/logs`) on Linux. The bridge state dir (update flag, default profile, watches, function run log, operations journal) keeps its 1.x name: `%LOCALAPPDATA%\mcp-chrome-bridge`, `~/Library/Logs/mcp-chrome-bridge`, `$XDG_STATE_HOME/mcp-chrome-bridge`.

## Upgrading from 1.x

### `npm i -g @mokuhub/mokutab-bridge` fails with `EEXIST`

The 1.x package `workatomcp-bridge` is still installed. The new package keeps its command names (`workatomcp-bridge`, `workatomcp-stdio`, `mcp-chrome-bridge`, `chrome-mcp-bridge`, `mcp-chrome-stdio`) as aliases until 3.0, so npm will not install it over the old one. Quit Chrome completely (on Windows the running native host locks the old package's files), then:

```bash
npm uninstall -g workatomcp-bridge
npm i -g @mokuhub/mokutab-bridge
```

Do not use `--force`: a later uninstall of the old package would delete the shared command names. The full order is in the [README upgrade section](../README.md#upgrade-from-workatomcp-1x).

### The data dir did not move

The first bridge start renames `~/.workatomcp` to `~/.mokutab`. `mokutab-bridge doctor` reports one of three states under **Data dir**:

- **Not moved yet.** The bridge has not started since the upgrade. Reload the extension or restart Chrome.
- **The move failed.** Something held the directory open (an editor, a terminal or Explorer window in it, a git process), and Windows refused the rename with `EPERM` or `EBUSY`. The bridge keeps using `~/.workatomcp` and tries again at every start. Close what holds it and restart Chrome, or move it by hand with Chrome closed (doctor prints the exact `move` or `mv` command).
- **Both exist.** The bridge uses `~/.mokutab` and leaves `~/.workatomcp` alone. A function still needed from the old directory has to be copied into `~/.mokutab/functions` and committed there by hand (doctor prints the git commands): an uncommitted copy of a vault function does not run, and `chrome_fn_save` refuses to save over it. Then delete the old directory.

### Every browser call asks for approval after re-registering

The tools now read `mcp__mokutab__*`. A permission allowlist (`settings.json`, `settings.local.json`) that names `mcp__workato__*` no longer matches; give it the new prefix. Bare tool names in skills and CLAUDE.md files keep working.

### Doctor says the bridge is still registered as `workato`

Claude Code still reaches the bridge under the 1.x key. It keeps working, with the old `mcp__workato__` prefix. Doctor prints the commands for the scope it found:

```bash
claude mcp add --transport http -s user mokutab http://127.0.0.1:12306/mcp
claude mcp remove workato -s user        # or -s local, run in the project it names
```

Then restart the Claude Code sessions.

## The MCP client can't connect

**Symptom:** `ConnectionRefused`, `fetch failed`, or the server shows as disconnected.

1. Is the extension loaded and enabled at `chrome://extensions/`?
2. Does the extension popup say the service is running? The bridge only starts when the extension asks it to.
3. `mokutab-bridge doctor --fix`, then reload the unpacked extension, then restart the MCP client.
4. Check the port is actually listening: `curl http://127.0.0.1:12306/ping`.

If something else already owns 12306:

```bash
mokutab-bridge update-port 12307
```

and update the extension popup and your client config to match.

## "Service Not Started" in the popup

The native-messaging host isn't registered for this browser, it's registered against a different extension ID, or its manifest points at a package that is gone (doctor says "path target does not exist" or "points into the old workatomcp-bridge package").

```bash
mokutab-bridge register --detect   # re-register for detected browsers
mokutab-bridge doctor              # confirm
```

On Linux and macOS a permissions problem on the host wrapper script shows up here too:

```bash
mokutab-bridge fix-permissions
```

## Chrome shows a different extension ID

The expected ID is `bpjpdgkeelhkijkllcmogemkmndgeana`, derived from the public key pinned in `app/chrome-extension/wxt.config.ts`. A different ID means the build used a different key, and native messaging will refuse the connection. So will the bridge's WebSocket: its log (stderr) then shows `[bridge] refused GET /ws-client: origin "chrome-extension://<id>" not allowed`, and the extension keeps retrying with backoff.

```bash
rm -rf app/chrome-extension/dist app/chrome-extension/.wxt
pnpm build:extension
```

Also check that `CHROME_EXTENSION_KEY` isn't set in your environment or in a local `.env`, overriding the pinned key.

## New tools don't show up

Schemas are read when a session starts:

1. `pnpm build:shared && pnpm build:extension`
2. `chrome_reload_extension`, or reload the unpacked extension at `chrome://extensions/`
3. Restart the MCP client (or re-add the server)

`chrome_bridge_info` reports the `tool_count` and `schema_revision` the running build serves: 52 tools with Workato off, 153 with it on.

## Timeouts

Reads retry once automatically and report `retried: true`. If a call still times out:

- Raise `timeout_ms` (clamped to 10 to 110 s). Note most MCP clients cut off around 60 s, so values above about 55 s also disable the auto-retry.
- For `workato_list_jobs`, a larger `timeout_ms` scans deeper per call; partial results come back with `next_cursor` to resume.
- For large recipes, switch to the file round-trip (`out_file` / `code_path`): the payload, not the network, is usually the problem.

**A timed-out write is not necessarily a failed write.** The Workato tools verify by re-reading state and report `save_status: "succeeded_after_timeout"`. Don't re-issue a write that reported that. If you do re-issue one and it had in fact landed, the save answers `save_status: "already_applied"` instead of creating a duplicate version.

`chrome_javascript` deserves its own warning: a timeout there abandons the wait, not the script. Fetches the page already issued still complete, so the work may be done even though the call reported an error. Check the resulting state before retrying anything non-idempotent, and raise `timeoutMs` (default 60 s) for scripts that legitimately take longer, or start it with `async_job: true` and poll the job.

## Workato module

### Workato shows as off

A fresh install starts with Workato off: only a machine that ran 1.x (where `~/.workatomcp` or the 1.x bridge state dir existed at the first 2.x start) keeps it on. Turn it on under **Modules** in the extension popup. The switch is one per machine, so every Chrome profile shows the same value.

- **The switch is greyed out.** The popup has no bridge connection; the note under it says so. Get the service running first (see above).
- **"This bridge cannot switch modules."** The bridge is older than 2.0. Install `@mokuhub/mokutab-bridge` and restart Chrome.
- **It is on, but the tools are missing.** The MCP client did not act on `notifications/tools/list_changed`. Start a new session.
- **It is off with `MOKUTAB_DATA_DIR` set.** An override dir is left alone at the first start, so nothing is recorded there, and a module the config does not mention is off.
- **The config file is broken.** A `config.json` that is not valid JSON keeps the last good state and is reported in the bridge log; the next popup change moves it aside to `config.json.malformed-<time>` and writes a fresh one.

A machine that once had the upstream `mcp-chrome-bridge` shares its state dir and starts with Workato on. One switch in the popup turns it off.

### `belongs to the Workato module, which is switched off`

The session still has the old tool list, or a skill names a Workato tool, while the module is off. Nothing was sent. Turn it on in the MokuTab popup, or use a core tool. While Workato is off, a call to an old name of a renamed core tool is refused too, with "`workato_bridge_info` is the old name of `chrome_bridge_info` ... Call `chrome_bridge_info` instead."

### `TabNotFound`

No signed-in Workato **app** tab is open. Open `https://app.workato.com` (or your region's URL), sign in, and leave the tab open. Docs, marketing, and status subdomains don't count: the tool needs the app itself.

If you passed an explicit `tabId`, that tab has been closed, navigated away, or isn't a Workato page.

### `MultipleWorkatoHosts`

Two different Workato regions are open at once (for example US and EU), so "the Workato tab" is ambiguous. Close all but one, or pin the one you want:

```
chrome_switch_profile(profile: "Default", tabId: 123)
```

### `WorkatoUnsafeAction`

`workato_call_action` blocked an action whose name doesn't look read-only. That's the safety gate doing its job. If the write is intended, re-issue with `allow_writes: true`, and be aware it will create, modify, or delete real records.

### `WorkatoConnectorError`

The connector itself rejected the call. Common causes:

- **`'Action name' must be present`** on `__adhoc_http_action`: both `mnemonic: "Custom action"` and `inspect: true` are required in the input.
- **A SOQL call that hangs and then times out**: `output_schema` was omitted, so Workato tried to introspect the whole object. Pass a one-field dummy schema.
- **"Connector doesn't support SQL to schema"**: that adapter has no SQL dialect; try `type: "suiteql"` / `"soql"` or use `workato_call_action`.
- **Connection lost / re-auth required**: check `authorization_status` via `workato_get_connection`.

### Save reported success but the data is gone

Workato accepts a save with HTTP 200 and `code_errors: []` while silently dropping dynamic input keys on any step that lacks a matching `extended_input_schema`: `py_eval` `code_input.data`, `call_recipe` `parameters`, `update_object` custom fields, data-table columns, `declare_variable` `variables`. The recipe then runs "successfully" against empty data.

The save tool reads the tree back and fails with `save_status: "persisted_incomplete"` listing the dropped paths. The fix is to declare the fields: `workato_recipe_set_extended_schema(recipe_id, step, kind: "extended_input_schema", schema: [...])`, then save again. See the [`workato-recipes` skill](../skills/workato-recipes/code-tree.md) for the schema shapes per action.

A related silent failure: a datapill written as `#{_dp('{"pill_type": "output", ...}')}`, with the `json.dumps` default spacing, is not recognized by Workato and resolves to an empty value. The save tool now compacts pill payloads for you; if you write pills through some other path, keep them space-free.

### Recipe save rejected while running

Workato refuses code saves on a running recipe. Pass `restart_if_running: true` to `workato_ui_save_recipe_code` (or to the `workato_recipe_*` mutators) and the tool will stop, save, verify and restart in one call.

That flag restarts only what the save itself stopped. A recipe that was **already stopped** before the call stays stopped: the response says so via `was_running: false` and a `recipe is STOPPED` note. Pass `ensure_running: true` when the recipe has to be live when the call returns.

### Save overwrote someone else's change

Pass `expected_base_version_no` (the `version_no` you pulled) on every write. The save is then refused if the recipe moved on in the meantime. Use `workato_recipe_version_diff(from, to)` to see what actually changed.

### Wrong workspace or environment

With several Workato accounts open, confirm where you actually are before writing anything:

```
workato_whoami()                    # workspace, user, role, environment
chrome_list_profiles()              # which Chrome profiles are connected
chrome_switch_profile(profile: ...) # pin the session
get_windows_and_tabs(filter: "workato")
```
