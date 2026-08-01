# Troubleshooting

Start here:

```bash
workatomcp-bridge doctor        # diagnose registration, ports, permissions
workatomcp-bridge doctor --fix  # repair what it can
```

If you need to file an issue, attach a redacted diagnostic report:

```bash
workatomcp-bridge report --copy   # Markdown report, secrets redacted, on the clipboard
```

## The MCP client can't connect

**Symptom** — `ConnectionRefused`, `fetch failed`, or the server shows as disconnected.

1. Is the extension loaded and enabled at `chrome://extensions/`?
2. Does the extension popup say the service is running? The bridge only starts when the extension asks it to.
3. `workatomcp-bridge doctor --fix`, then reload the unpacked extension, then restart the MCP client.
4. Check the port is actually listening — `curl http://127.0.0.1:12306/ping`.

If something else already owns 12306:

```bash
workatomcp-bridge update-port 12307
```

and update the extension popup and your client config to match.

## "Service Not Started" in the popup

The native-messaging host isn't registered for this browser, or it's registered against a different extension ID.

```bash
workatomcp-bridge register --detect   # re-register for detected browsers
workatomcp-bridge doctor              # confirm
```

On Linux and macOS a permissions problem on the host wrapper script shows up here too:

```bash
workatomcp-bridge fix-permissions
```

## Chrome shows a different extension ID

The expected ID is `bpjpdgkeelhkijkllcmogemkmndgeana`, derived from the public key pinned in `app/chrome-extension/wxt.config.ts`. A different ID means the build used a different key, and native messaging will refuse the connection.

```bash
rm -rf app/chrome-extension/dist app/chrome-extension/.wxt
pnpm build:extension
```

Also check that `CHROME_EXTENSION_KEY` isn't set in your environment or in a local `.env`, overriding the pinned key.

## `TabNotFound`

No signed-in Workato **app** tab is open. Open `https://app.workato.com` (or your region's URL), sign in, and leave the tab open. Docs, marketing, and status subdomains don't count — the tool needs the app itself.

If you passed an explicit `tabId`, that tab has been closed, navigated away, or isn't a Workato page.

## `MultipleWorkatoHosts`

Two different Workato regions are open at once (for example US and EU), so "the Workato tab" is ambiguous. Close all but one, or pin the one you want:

```
workato_switch_profile(profile: "Default", tabId: 123)
```

## `WorkatoUnsafeAction`

`workato_call_action` blocked an action whose name doesn't look read-only. That's the safety gate doing its job. If the write is intended, re-issue with `allow_writes: true` — and be aware it will create, modify, or delete real records.

## `WorkatoConnectorError`

The connector itself rejected the call. Common causes:

- **`'Action name' must be present`** on `__adhoc_http_action` — both `mnemonic: "Custom action"` and `inspect: true` are required in the input.
- **A SOQL call that hangs and then times out** — `output_schema` was omitted, so Workato tried to introspect the whole object. Pass a one-field dummy schema.
- **"Connector doesn't support SQL to schema"** — that adapter has no SQL dialect; try `type: "suiteql"` / `"soql"` or use `workato_call_action`.
- **Connection lost / re-auth required** — check `authorization_status` via `workato_get_connection`.

## Timeouts

Reads retry once automatically and report `retried: true`. If a call still times out:

- Raise `timeout_ms` (clamped to 10–110 s). Note most MCP clients cut off around 60 s, so values above ~55 s also disable the auto-retry.
- For `workato_list_jobs`, a larger `timeout_ms` scans deeper per call; partial results come back with `next_cursor` to resume.
- For large recipes, switch to the file round-trip (`out_file` / `code_path`) — the payload, not the network, is usually the problem.

**A timed-out write is not necessarily a failed write.** The tools verify by re-reading state and report `save_status: "succeeded_after_timeout"`. Don't re-issue a write that reported that.

## Recipe save rejected while running

Workato refuses code saves on a running recipe. Pass `restart_if_running: true` to `workato_ui_save_recipe_code` (or to the `workato_recipe_*` mutators) and the tool will stop → save → verify → restart atomically.

## Save overwrote someone else's change

Pass `expected_base_version_no` — the `version_no` you pulled — on every write. The save is then refused if the recipe moved on in the meantime. Use `workato_recipe_version_diff(from, to)` to see what actually changed.

## New tools don't show up

Schemas are read once at connect time:

1. `pnpm build:shared && pnpm build:extension`
2. Reload the unpacked extension at `chrome://extensions/`
3. Restart the MCP client (or re-add the server)

## Wrong workspace or environment

With several Workato accounts open, confirm where you actually are before writing anything:

```
workato_whoami()                     # workspace, user, role, environment
workato_list_profiles()              # which Chrome profiles are connected
workato_switch_profile(profile: ...) # pin the session
get_windows_and_tabs(filter: "workato")
```
