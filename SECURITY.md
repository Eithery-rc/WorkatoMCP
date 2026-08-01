# Security policy

## Reporting a vulnerability

Report privately — do not open a public issue.

- Preferred: [GitHub private security advisory](https://github.com/Eithery-rc/WorkatoMCP/security/advisories/new)
- Alternative: chikalenkor@gmail.com

Please include the affected version (`workatomcp-bridge --version` and the extension version), reproduction steps, and the impact you believe it has. Expect an initial response within a week. Please give a reasonable window to ship a fix before disclosing publicly.

## Supported versions

Only the latest published `workatomcp-bridge` and `workatomcp-shared` releases, paired with an extension built from `master`, receive security fixes.

## What this software can do

WorkatoMCP is a local automation bridge. Being clear about its power matters more than reassurance:

- **It acts as you, in your Workato workspace.** Requests execute inside a signed-in Workato tab and carry your session cookies and CSRF token. Everything you can do in the UI, an agent can attempt through these tools — including deleting recipes, folders, and tables.
- **It can reach the SaaS systems behind your connections.** `workato_call_action` invokes connector actions directly; with `allow_writes: true` it can create, modify, or delete real production records in Salesforce, NetSuite, and everything else you've connected.
- **The Chrome extension holds broad permissions** — `<all_urls>` host access plus `tabs`, `scripting`, `debugger`, `webRequest`, `downloads`, `history`, and `bookmarks` — inherited from the upstream browser-automation project. Only install it in a browser profile you're willing to expose to your MCP client.
- **The bridge reads and writes local files** on request, to support the recipe and CSV round-trips (`out_file`, `code_path`, `csv_path`).

Treat an MCP client with these tools attached as a principal with your Workato permissions, and scope the browser profile accordingly.

## Built-in safeguards

| Safeguard                            | What it does                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Write gate**                       | `workato_call_action` refuses any action that isn't read-shaped unless the caller passes `allow_writes: true`. Read-shaped means a `search_`/`get_`/`list_`/`query_`/`find_`/`describe_`/`read_`/`fetch_` prefix, exactly `execute_suiteql`, or `__adhoc_http_action` with a `get`/`head`/`options` verb. |
| **Secret stripping**                 | Connection responses have secret-shaped keys removed on every path, including `full: true`. There is no tool that returns an OAuth token, API key, or password.                                                                                                                                           |
| **No credential storage**            | No tokens, cookies, or session material are persisted by the extension or the bridge, or transmitted anywhere other than between the two on the local machine.                                                                                                                                            |
| **Local-only binding**               | The bridge listens on `127.0.0.1:12306`. It is not reachable from the network.                                                                                                                                                                                                                            |
| **Deterministic extension identity** | The pinned public key produces a fixed extension ID, and the bridge's native-messaging allowlist accepts only that ID.                                                                                                                                                                                    |
| **Explicit tab targeting**           | Tools never act on "the focused tab". They resolve an explicit `tabId`, a pinned session tab, or an unambiguous Workato app tab — and refuse when several Workato regions are open at once.                                                                                                               |
| **Optimistic locking**               | Recipe saves accept `expected_base_version_no`, so a concurrent edit fails loudly instead of being silently overwritten.                                                                                                                                                                                  |
| **Write verification**               | Timed-out writes are verified by re-reading state rather than retried blindly, so a partial write is never duplicated.                                                                                                                                                                                    |

## Recommended practice

- Run the agent against a **sandbox or dev Workato workspace** first. Verify with `workato_whoami` before any write.
- Leave `allow_writes` off by default. Turn it on for a specific, reviewed call.
- Prefer a **dedicated Chrome profile** for MCP work rather than your everyday browsing profile.
- Pass `expected_base_version_no` on recipe writes, and confirm with `workato_recipe_version_diff` afterwards.
- Remember that `workato_delete_folder` cascades to everything inside it, and that data-table and lookup-table deletes are not recoverable.

## Out of scope

- The broad permission surface of the inherited browser-automation tools. It's a known, documented property of the upstream design, not a vulnerability.
- Anything requiring an attacker who already has local code execution or access to your browser profile.
- Workato's own endpoints and their behaviour. Report those to Workato.
