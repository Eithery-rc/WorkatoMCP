/**
 * PLANNED v1.2+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_create_connection — POST /connections.json
 *
 * Body shape (reverse-engineer before implementing):
 *   {
 *     "connection": {
 *       "name": "<display name>",
 *       "provider": "<adapter id, e.g. 'salesforce', 'netsuite'>",
 *       "folder_id": <int>,
 *       "input": { ...per-provider config + auth params... }
 *     }
 *   }
 *
 * Headers: content-type: application/json; charset=utf-8,
 *          x-csrf-token: <decoded XSRF-TOKEN-V2 — see csrf.ts>,
 *          x-requested-with: XMLHttpRequest.
 *
 * Safety rules to enforce in code:
 *
 *   1. NEVER LOG OR ECHO THE INPUT BLOB — it contains the user's
 *      credentials. The tool's success response must report only
 *      the new connection id + provider, NOT what was sent.
 *   2. RESPONSE SECRET-STRIPPING — apply stripConnectionSecrets()
 *      (see ./strip-secrets.ts) to the creation response before
 *      returning. Workato may echo back the auth params; agents
 *      must not see them.
 *   3. PROVIDER VALIDATION — Workato accepts any provider string
 *      but invalid ones produce confusing 422s. Maintain an
 *      allowlist of verified providers (start with the 10 seen in
 *      v1.1 reverse-engineering: salesforce, netsuite, sftp, sap,
 *      pgp, rest, onprem_files, azure_blob_storage, steelbrick,
 *      workato_app) and reject unknowns with a clear error.
 *
 * Failure modes:
 *   - 401/403 → session expired; user must re-auth.
 *   - 422 → invalid input shape; surface the validation errors verbatim.
 *
 * Open questions before implementation:
 *   - Does Workato echo the auth_token in the create response?
 *   - Is there a separate `/connections/<id>/authorize` step for OAuth
 *     providers, or does the create response include the auth URL?
 */
export const PLANNED_CREATE_CONNECTION_NOTES = true;
