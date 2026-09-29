# Deployments and environment switching

Date: 2026-09-29. Status: implementing. Evidence: live capture on app.workato.com, workspace "Legacy" (Development 8070978, Test 8070982, Production 8070980), project Vantiv (root folder 31901099, project 16680605). One real deploy was run: recipe "LGCY | FUNC | Vantiv Payment Files Processor", Dev 73975333 v13 to Prod 74546900 (v4 to v5), deployment 313765, build 310903.

## Environments and workspaces

- Environment ids are team ids. A workspace's id equals its Development environment id (Legacy: 8070978). `GET /web_api/auth_user.json` lists them: `environment.available` / `environment.all` / `environment.current` (`{id, name, type: dev|test|prod}`), and `teams` (other workspaces, `{id, name, role}`).
- `GET /web_api/project_folders/<folder_id>/deployable_environments.json` -> `{"result": [{"id": 8070978, "name": "Development", "type": "dev"}, {"id": 8070982, "name": "Test", "type": "test"}, {"id": 8070980, "name": "Production", "type": "prod"}]}`
- Switching is a GET navigation with one redirect, not an XHR (found in the JS bundle, verified live):

```
/users/switch_environment?environment_id=<env id>[&return_to=<url-encoded path>]
/users/switch_team?team_id=<team id>&team_name=<team name>        (both encodeURIComponent)
```

- With `return_to=%2Frecipes%2F73975333` the tab landed on `/recipes/73975333` in Development (redirectCount 1). Without it, it lands on `/` then `/?fid=projects`.
- The "View in PROD" button after a deploy calls the same environment switch.
- A debugger network capture shows only the final document, never the switch URL.
- **The session is per Chrome profile (cookie). A switch moves every Workato tab in that profile.**
- `switch_team` was read from the bundle (`switchToWorkspace`) and verified live through workato_switch_environment (Legacy to Power Factors and back). It takes no return_to, so the tool navigates to return_to itself. The OEM flag `team_switching_disabled` hides it.

## Deployment history

```
GET /web_api/project_folders/<folder_id>/project_builds.json?page=1&created_at_to=<iso>
  -> {"result": {"items": [BUILD...], "count", "page", "per_page": 20, "total"}}
BUILD = {id, title, description, project_folder_id, state: "deploy_finished", error, zip_file_name,
         created_at, updated_at, project_id, performed_by_user {id, name, avatar_url}, reviews: [],
         deployment_id, environment_id, environment_type, environment_name}
GET /web_api/project_folders/<folder_id>/performers.json -> {"result": [{id, name, avatar_url}]}
GET /web_api/projects/f<folder_id>.json                  -> {"result": {id: "<project_id>", name, folder_id, project_type, editors, roles}}
```

Drafts that were never deployed do not appear in `project_builds`.

## Deploy flow

The recipe page's "Deploy to > TEST/PROD" and the project page's button open the SAME project wizard. Choosing the environment already creates a server-side draft.

1. **Create the draft:**
   ```
   POST /web_api/project_folders/<folder_id>/deployments.json
   {"title": "", "description": "", "reviewer_ids": [], "environment_id": 8070980}
   -> 201 {"result": {id: 313765, title: "Deploy Vantiv to Production", environment_id, state: "pending",
                      manifest_with_diff: null, target_folder_id: 32215062,
                      project_build: {id: 310903, state: "pending", zip_file_name: null, project_id, manifest: [ASSET...]}}}
   ASSET = {id, name, type: recipe|lookup_table|workato_db_table, version, folder: "Vantiv/Recipes",
            absolute_path: "Home/Vantiv/Recipes", root_folder, include_test_cases (recipe) | include_data (tables),
            unreachable, zip_name, deps: [{id, type, name, unreachable}], checked: true}
   ```

   - Every project asset comes back `checked: true`.
   - The recipe page's button differs only on the client: it keeps the recipe and its transitive deps checked and unchecks the rest. Live, it kept Processor 73975333 + Create NetSuite 73975178 (called recipe) + data table 126437 + lookup table 4934952 (a dep of 73975178), and unchecked Listener 73975368 (it depends on the Processor, not the other way round).
   - Connections appear only as `deps` with `unreachable: true`. They are never in the package.
2. **Select the assets:** `PUT /web_api/deployments/<id>.json` with `{"manifest": [ASSET with checked true|false]}`. Returns 200, same shape.
3. **Calculate the diff:**
   ```
   PUT /web_api/deployments/<id>/start_diff_calculation.json   {"include_tags": true}   -> state "diff_calculation_started"
   poll GET /web_api/deployments/<id>.json (~3 s)                                         -> state "diff_calculation_finished"
     manifest_with_diff: [{id: <TARGET env id>, name, type, state: "changed"|"no_change", changes: ["code"],
                           running, folder, zip_name, include_test_cases|include_data, contains_data}]
     project_build.state "build_finished", zip_file_name "Vantiv_20260929_1210.zip",
     include_tags, recipes_to_stop: [], imported_recipes_status: {stopped, restarted, failed, stop_failed}
   ```

   - `manifest_with_diff` carries TARGET ids (74546900, 74546899, 134082, 4936468), `manifest` carries source ids. Join them on `zip_name`.
   - UI labels: `changed` + `code` shows as "Update running logic", `no_change` as "No change". The summary line read "0 Assets will be added / 1 Assets will be updated". The state for a new asset was not observed.
4. **Recipe diff against the target:**
   ```
   UI:   /recipes/diff/deployment?deployment_id=<id>&recipe_id=<source recipe id>
   DATA: GET /recipes/compare?v1=<rid>%3Adeployment_id%3A<id>&v2=<rid>%3Aversion_no%3Alast
     -> {"v1": {"code": "<json string>", "connection_config": "<json string>"}, "v2": {...}}   (~300 KB)
   ```

   - `v1` is the target recipe as it is now (target ids), `v2` is the source's last version (source ids).
   - **Remap caveat:** a naive step diff flagged 6 steps. Only one was real: `38ef2487` `input.code`, 37,897 to 39,118 chars (parser 1.5.0 to 1.5.1). The other 5 differed only by environment remap: `input.table_id` in 4 steps (126437 vs 134082) and `input.flow_id` in 1 (73975178 vs 74546899).
   - Ids are objects `{id, type, folder, name}`. Normalise by `{type, name}` before diffing, as the UI does ("1 step change").
   - `connection_config` was identical on both sides.
5. **Name the deployment:** `PUT /web_api/deployments/<id>.json` with `{"title": "Vantiv to PROD", "description": "", "reviewer_ids": [], "environment_id": 8070980}`. The UI requires the title ("Deployment name\*").
6. **Deploy:**
   ```
   PUT /web_api/deployments/<id>/start_deploy.json   {"include_tags": true, "retry_deploy": false}   -> state "deploy_started"
   poll GET -> state "deploy_failed", error "Recipes require action: stop",
               recipes_to_stop: [{id: 74546900, name, stop_reason: null}]
   ```

   - Not a real failure: a changed recipe is running in the target.
   - UI: "To overwrite running recipes, we first need to stop them... We will automatically restart it after it's been deployed. If your recipe uses incoming webhooks, you might miss some events. We cannot stop recipes that have pending jobs." with buttons [Stop recipes and continue deploying] [Quit deploying].
   ```
   PUT /web_api/deployments/<id>/start_deploy.json   {"include_tags": true, "retry_deploy": true}    -> state "deploy_started"
   poll GET (~3 s) -> state "deploy_finished", project_build.state "completed",
                      imported_recipes_status: {stopped: [], restarted: [{id: 74546900, name}], failed: [], stop_failed: []}
   ```

**States.** Deployment: `pending -> diff_calculation_started -> diff_calculation_finished -> deploy_started -> [deploy_failed "Recipes require action: stop" -> deploy_started] -> deploy_finished`. Build: `pending -> build_started -> build_finished -> completed`.

**Side effect.** Opening the wizard twice left draft 313764 / build 310902 in state `pending`. No delete or cancel route was captured. The draft is invisible in history and deployed nothing.

**Live result 2026-09-29.** Prod 74546900 was running at v4 and was stopped, deployed and restarted by Workato (restarted 12:14:49 PDT). It now runs v5, and `workato_recipe_grep` finds the 1.5.1 code in `38ef2487` (39,118 chars). Listener 74546901 v2 and Reprocessor 79305388 v3 kept running.

## Tool contract

As designed on 2026-09-29. The implementation had not been live-verified when this was written.

| Tool                         | Params                                                                                                                                                                                                                        | Returns                                                                                                                                                                                                                            | Gate                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workato_switch_environment` | `environment` (`dev`/`test`/`prod`, a name or an id), `workspace` (team name or id, optional), `return_to` (path, optional), `tabId`                                                                                          | session context before and after                                                                                                                                                                                                   | none (no data change); the description warns that every Workato tab in the Chrome profile moves                                                                                     |
| `workato_deployments_list`   | `recipe_id`, `folder_id` or `project`, `page`                                                                                                                                                                                 | `project_builds` items plus `deployable_environments`                                                                                                                                                                              | read                                                                                                                                                                                |
| `workato_deploy_plan`        | `environment`, `recipe_id` (recipe + transitive deps, as the recipe page does) or `folder_id` / `project` (whole project), `include` / `exclude` asset ids, `include_step_diff` (default true), `include_tags` (default true) | `deployment_id`, the checked manifest, `manifest_with_diff` joined to source ids, a summary (added / updated / no_change), `step_diffs` per changed recipe (remap-normalised), `will_stop` (changed recipes running in the target) | creates a draft deployment (a server object, not a data change)                                                                                                                     |
| `workato_deploy_run`         | `deployment_id`, `title`, `description`, `allow_writes: true`, `allow_stop_running`                                                                                                                                           | final state, `imported_recipes_status`                                                                                                                                                                                             | `allow_writes` required. Without `allow_stop_running`, a "Recipes require action: stop" answer comes back as `status: "needs_stop"` with `recipes_to_stop`, and nothing is deployed |

The reload side of this release (`workato_reload_extension`, commit c1937fc) is documented in `docs/TOOLS.md`.
