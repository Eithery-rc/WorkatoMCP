# Security policy

## Reporting a vulnerability

Report privately; do not open a public issue.

- Preferred: [GitHub private security advisory](https://github.com/MokuHub/MokuTab/security/advisories/new)
- Alternative: chikalenkor@gmail.com

Please include the affected version (`mokutab-bridge --version` and the extension version), reproduction steps, and the impact you believe it has. Expect an initial response within a week. Please give a reasonable window to ship a fix before disclosing publicly.

## Supported versions

Only the latest published `@mokuhub/mokutab-bridge` and `@mokuhub/mokutab-shared` releases, paired with the extension from the matching [GitHub release](https://github.com/MokuHub/MokuTab/releases) (or one built from `master`), receive security fixes. The 1.x packages get no further releases. Check a downloaded extension zip with `gh attestation verify <zip> --repo MokuHub/MokuTab` before loading it.

## What this software can do

MokuTab is a local automation bridge into your own browser. Being clear about its power matters more than reassurance:

- **It acts as you, in every site you are signed in to.** The core tools read pages, click, type, run JavaScript in the page, capture network traffic and fetch URLs with the tab's cookies, in any Chrome profile connected to the bridge.
- **With the Workato module on, it acts as you in your Workato workspace.** Requests execute inside a signed-in Workato tab and carry your session cookies and CSRF token. Everything you can do in the UI, an agent can attempt through these tools, including deleting recipes, folders, and tables.
- **It can reach the SaaS systems behind your Workato connections.** `workato_call_action` invokes connector actions directly; with `allow_writes: true` it can create, modify, or delete real production records in Salesforce, NetSuite, and everything else you've connected.
- **Browser functions can type vault values.** A function a person wrote and committed can read a login from your Bitwarden vault with the `bw` CLI and type it into a matching page.
- **The Chrome extension holds broad permissions**: `<all_urls>` host access plus `tabs`, `scripting`, `debugger`, `webRequest`, `downloads`, `history`, and `bookmarks`, inherited from the upstream browser-automation project. Only install it in a browser profile you're willing to expose to your MCP client.
- **The bridge reads and writes local files** on request, for `out_file`, `chrome_fetch_to_file`, the recipe and CSV round-trips (`code_path`, `csv_path`) and the function registry.

Treat an MCP client with these tools attached as a principal with your browser identity, and scope the browser profile accordingly.

## Built-in safeguards

| Safeguard                            | What it does                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local-only binding**               | The bridge listens on `127.0.0.1:12306`. It is not reachable from the network. Every HTTP route refuses a request whose Origin is present and not allowed, or whose Host is not `127.0.0.1` or `localhost` on the bridge's port, which also stops DNS rebinding.                                          |
| **Deterministic extension identity** | The pinned public key produces a fixed extension ID. The native-messaging allowlist, the extension WebSocket and CORS accept only that ID.                                                                                                                                                                |
| **No credential storage**            | No tokens, cookies, or session material are persisted by the extension or the bridge, or transmitted anywhere other than between the two on the local machine.                                                                                                                                            |
| **Output redaction**                 | Cookie strings, query strings, tokens and secret-shaped fields are redacted from page results before they reach the agent. `chrome_fetch_to_file` and an explicit `out_file` write to disk unredacted, by design.                                                                                         |
| **Vault gate**                       | A function reads the vault only while its file is exactly as committed and a person, not `chrome_fn_save`, made its last commit. Vault values are typed only on pages that match the item's URIs and are scrubbed from step values, errors, replies and the run log.                                      |
| **Previewed commits**                | A browser function of kind `write` or `send` returns a preview first and commits only on `confirm`; a failure at or after a commit is reported as `unknown`, never retried.                                                                                                                               |
| **Write gate**                       | `workato_call_action` refuses any action that isn't read-shaped unless the caller passes `allow_writes: true`. Read-shaped means a `search_`/`get_`/`list_`/`query_`/`find_`/`describe_`/`read_`/`fetch_` prefix, exactly `execute_suiteql`, or `__adhoc_http_action` with a `get`/`head`/`options` verb. |
| **Secret stripping**                 | Workato connection responses have secret-shaped keys removed on every path, including `full: true`. There is no tool that returns an OAuth token, API key, or password.                                                                                                                                   |
| **Explicit tab targeting**           | Tools never act on "the focused tab". They resolve an explicit `tabId`, a lease, a pinned session tab, or an unambiguous Workato app tab, and refuse when several Workato regions are open at once.                                                                                                       |
| **Optimistic locking**               | Recipe saves accept `expected_base_version_no`, so a concurrent edit fails loudly instead of being silently overwritten.                                                                                                                                                                                  |
| **Write verification**               | Timed-out writes are verified by re-reading state rather than retried blindly, so a partial write is never duplicated.                                                                                                                                                                                    |

## Recommended practice

- Run the agent against a **sandbox or dev workspace** first. For Workato, verify with `workato_session_context` or `workato_whoami` before any write.
- Leave `allow_writes` off by default. Turn it on for a specific, reviewed call.
- Prefer a **dedicated Chrome profile** for MCP work rather than your everyday browsing profile.
- Keep modules you do not use switched off in the popup: a switched-off module's tools are neither listed nor run.
- Pass `expected_base_version_no` on recipe writes, and confirm with `workato_recipe_version_diff` afterwards.
- Remember that `workato_delete_folder` cascades to everything inside it, and that data-table and lookup-table deletes are not recoverable.

## Out of scope

- The broad permission surface of the inherited browser-automation tools. It's a known, documented property of the upstream design, not a vulnerability.
- Anything requiring an attacker who already has local code execution or access to your browser profile.
- Workato's own endpoints and their behaviour. Report those to Workato.
