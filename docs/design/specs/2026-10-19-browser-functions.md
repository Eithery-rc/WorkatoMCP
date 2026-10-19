# Browser functions (`chrome_fn_*`)

Date: 2026-10-19. Status: implemented, live-verified, unreleased.

## Why

Agents that work in a client's NetSuite or Jira through this bridge rebuild the same browser flows every session: open a form in a new window, wait for its editor, write text above the signature, check the recipient, click submit, confirm the row in SuiteQL, close the window. Each rebuild means digging the earlier JavaScript out of an old transcript and hitting the same pitfalls again (a form whose settle always times out, `require` missing outside record pages, an integer field that rejects 1.5). The request that started this listed seven such flows from one week of work.

A function captures a flow once, with parameters, and keeps it versioned so the agent that hits a failure can save the fix for everyone after it.

## Decisions

| Question           | Decision                                                                                                                                                         | Why                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Who executes steps | The bridge, as an orchestrator over messages the extension already answers                                                                                       | Same shape as the recipe orchestrators; the registry and run log need the filesystem; no new page-side code    |
| Window             | A window of the run's own, opened and closed by the run; steps cannot name a tab                                                                                 | A function can then never act in the user's tab or another agent's, by construction, so no deny list is needed |
| Storage            | One YAML file per function in a private git repo, `~/.workatomcp/functions`                                                                                      | Readable and diffable by a person; git is the version history; client specifics stay out of this public repo   |
| Format             | YAML with code as literal blocks                                                                                                                                 | JSON with `\n` escapes is unreadable in a diff                                                                 |
| Concurrency        | `base_version` on every save of an existing name, refused when stale; uncommitted hand edits block a save                                                        | Two agents fixing the same function must not silently overwrite each other                                     |
| Write safety       | A `write` or `send` without `confirm` stops before its first commit step and keeps the window for 10 minutes; `confirm` with the `run_id` commits in that window | What the user approved is exactly what is committed                                                            |
| One-call writes    | Allowed for `write`, refused for `send`                                                                                                                          | A batch of time entries should not cost two calls each; an email leaves the system                             |
| Unknown outcomes   | Any failure at or after a commit step is `unknown`, with a `verify_hint`; never retried                                                                          | A timed-out save can still land (seen live: an employee save outlived the call)                                |
| SQL steps          | No dedicated step; a helper runs SuiteQL in the page through `N/query`, and `verify_hint` names the query for MokuBot                                            | The bridge cannot reach another MCP server, and `N/query` works client-side on record pages                    |
| Params             | A JSON Schema subset, strict: unknown params and wrong types are errors                                                                                          | A typo must not fall back to a default; `custevent10` is an integer                                            |
| Secrets            | No credential literals in definitions (checked at save); results redacted                                                                                        | Definitions are files any agent may write                                                                      |
| Logins             | The bridge reads Bitwarden values itself (`vault`), only into fill steps, only on the item's own sites, only for functions a person committed                    | No model context ever holds the password or the code, and a login needs no subagent                            |
| Closed definitions | Unknown keys anywhere in a definition are errors; `target.host` is required for `write` and `send`                                                               | A typo (`comit`, `dedup_key`) must not silently switch a safeguard off                                         |
| Crash safety       | A `commit_start` line is logged right before each commit step                                                                                                    | A bridge that dies mid-commit still leaves the record that blocks a duplicate                                  |

## Execution model

`chrome_fn_run` validates the params, resolves the profile (call, then `target.profile`, then the session pin, then the bridge default), opens the target URL with `AGENT_TAB_OPEN` and waits for the tab to report `complete` through the tabs API (`AGENT_TAB_INFO`). Navigation steps use `AGENT_TAB_NAVIGATE`, which updates the tab and waits for a load that completes after the update. Unlike `chrome_navigate` it never falls back to another tab when the tab is gone.

JS steps go through `chrome_javascript` with `rawOutput`, so values chain between steps unredacted; the final reply is redacted in the bridge with the same sanitizer, now in `workatomcp-shared`. Each step's code is composed as `const args = <JSON>; const prev = <JSON>; const h = {}; <helpers>; <body>`, and its return is wrapped with the page URL so the runner always knows where the tab is.

`wait_for` polls every 500 ms. A probe that errors (a page mid-navigation) counts as not ready; the last error is reported on timeout. `url`, `exists` and `missing` conditions use the tabs API and `chrome_find_elements` (scripting, ISOLATED world), so they work on pages where CDP cannot attach, such as a login page with a password-manager iframe.

Before every commit step the tab host is compared with `target.host`. A mismatch (a redirect to a login page) fails the run before anything is committed. A `dedupe_key` is checked before the window opens and held while the commit runs, so two calls cannot commit the same key at once.

## Vault values

A login cannot pass its password as a param without putting it into the calling model's context, which the old setup avoided by delegating logins to a subagent that read Bitwarden itself. A function instead declares `vault` entries (`{item, field}`) and uses `"{vault.name}"` as the whole value of one fill. The bridge reads the value with `bw get <field> <item>` at that step.

The rules that keep a typed secret from reaching a model:

- **Placement.** A vault value is only ever the `value` of `chrome_computer` (`action: fill`) or `chrome_fill_or_select`; validation refuses it in any other template, JS code, URL or message.
- **Sites.** The page must be https and match one of the item's own URIs (Bitwarden's match types; a starts-with URI must end at a path boundary; app URIs never match). The match is checked before the value is read and again right before it is typed, since reading takes seconds.
- **Shape.** A vault function is kind `read`, runs in a window of its own, loads no helpers and has no pause step, so no window waits with a typed secret in it; `keep_open` is ignored and the window always closes. Items are named by id (a UUID), never by a search word.
- **Who writes such a function.** `chrome_fn_save` refuses any definition with `vault` and never replaces one; a run requires that the file is exactly what is committed and that its last commit was not made by `chrome_fn_save`. Registry git calls run with hooks and fsmonitor disabled.
- **Output.** Each value read is scrubbed from step values, error messages, the reply and the trace; the run log keeps only item ids.

Scope: this is a personal tool. The rules stop a vault function from arriving through `chrome_fn_save` and keep values out of replies, but they are not a sandbox against an agent that can write arbitrary files on the machine (other tools' `out_file` can), nor against anything else running as the user, which can read `BW_SESSION` from the user environment the same way the bridge does.

The session key is read from `BW_SESSION` in the Windows user environment first: the bridge inherits its environment from Chrome at Chrome's start, so its own `BW_SESSION` is often stale after the next `bw unlock`.

## Found while building it

- NetSuite answers a fetch of a page the role may not open with a redirect to `/app/login/secure/myroles/myrolesdeeplinks.nl?permName=...&permCode=...`, status 200. A check for `/app/login/` reads that as an expired session. The NetSuite helper now reports the missing permission by name.
- `tinymce.get('message')` exists on the NetSuite email form before the editor has a body; waiting for `initialized` and `getBody()` is required.
- `innerText` inside an editor iframe of a background window behaves like `textContent` and glues paragraphs; the email preview builds its text per block.
- The output sanitizer matched sensitive key names anywhere inside a key, so `subsidiary` (contains `sid`) and `author` (contains `auth`) came back as `<redacted>`. The short markers `sid` and `auth` now match a word of the key (with Google's SID cookie names and `oauth` covered); markers of five letters or more still match anywhere, so plurals and compounds (`cookies`, `credentials`, `passwordhash`) stay redacted. A first word-only version leaked those and was caught in review.
- A credential-literal check that flags `token: '<value>'` also flagged Atlassian's fixed `'X-Atlassian-Token': 'no-check'` header. Only values with a digit or 20+ characters count now.
- A NetSuite role's home page is not always `card.nl`: opening it can land on another center (`mainsetup.nl`). "Logged in" means any `/app/` page outside `/app/login/`.
- A vault item can have a username and no password (security questions in custom fields instead). The login stops at that step with the vault's own message, before anything is submitted.

## Open items

- **Login branches not yet seen live.** The already-logged-in branch and the stop on a vault item without a password ran live. The full form submit and the 2FA branch follow the old login subagent's notes and run first in real use: no account tried so far was logged out with a complete vault item.
- **Helpers are not versioned per function.** A run uses the helpers as they are at run time; a helper change can break a function that did not change. The run log does not record the helper version yet.
- **Pending runs live in memory.** A bridge restart drops previews and pauses; their windows stay open until closed by hand.
