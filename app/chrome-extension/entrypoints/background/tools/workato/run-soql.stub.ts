/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_run_soql — POST /utils/sample_to_schema.json
 *
 * Headers: content-type: application/json,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * Body:
 *   { "sample": "<SOQL>", "type": "soql", "shared_account_id": <int> }
 *
 * Response:
 *   { "result": { "schema": [...], "sample": [ {row}, ... ] } }
 *
 * Caveats:
 *   - Hard-capped to ~100-150 rows server-side. Surface this in the response.
 *   - 422 → almost always stale CSRF. Re-read cookie and retry ONCE before
 *     failing (don't paste the token into the function literal; read it from
 *     document.cookie at call time so it's always fresh).
 *   - 403 → session expired; user must re-log into Workato.
 *   - Empty sample: [] with status 200 → SOQL returned no rows OR the query
 *     is malformed (Workato may swallow the SF error). Caller decides.
 *   - shared_account_id is the connection id. Find it on
 *     /connections/<id>/extended_schema.json or in any recipe step's account_id.
 *   - Treat as read-only — no DML through this endpoint.
 *   - Workato logs every call — don't loop tightly.
 */
export const PLANNED_RUN_SOQL_NOTES = true;
