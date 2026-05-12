/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_push_recipe — PUT /recipes/<id>.json
 *
 * Body shape (top-level keys are exactly flow / client_uuid / error_format —
 * NOT {recipe: {...}}):
 *
 *   {
 *     "flow": {
 *       "name", "description", "visibility_private", "curated",
 *       "last_version_no": <int — must equal current server version>,
 *       "code":   "<stringified JSON of code tree>",
 *       "config": "<stringified JSON of connector accounts — usually unchanged>",
 *       "copy_in_progress": false,
 *       "worker_concurrency": 1,
 *       "folder_id": <int>,
 *       "job_data_retention_policy": "default"
 *     },
 *     "client_uuid": "<uuid v4>",
 *     "error_format": "json"
 *   }
 *
 * Headers: content-type: application/json; charset=utf-8,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 cookie — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * DO NOT GZIP THE BODY — Workato accepts uncompressed; gzipping breaks if
 * encoding is wrong.
 *
 * Safety rules to enforce in code, not just docs:
 *
 *   1. PULL-BEFORE-PUSH — tool requires caller to pass a version_no obtained
 *      from a recent workato_pull_recipe. Stale last_version_no → 409.
 *   2. BACKUP-BEFORE-PUSH — write the pre-push state to
 *      .workato/<id>.before.<ts>.json before the PUT.
 *   3. REJECT WHILE /edit OPEN — chrome.tabs.query for the recipe's edit URL;
 *      if found, refuse with RecipeOpenInEditMode. Editor caches the recipe
 *      in memory; saving in the UI after a programmatic push silently
 *      overwrites our edits (server version_no advances but field changes
 *      disappear).
 *   4. NO flow.config MUTATION unless caller explicitly passes
 *      allow_config_changes: true.
 *   5. NO mutation of flow.id / version_no outside the documented role.
 *
 * Failure modes:
 *   - 409 → version mismatch; re-pull, re-apply edits, retry once.
 *   - 401/403 → session expired; user must re-auth.
 *   - 200 with non-empty result.flow.code_errors or .requirements_errors →
 *     semantic rejection; surface the errors.
 */
export const PLANNED_PUSH_RECIPE_NOTES = true;
