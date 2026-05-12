/**
 * PLANNED v1.1+ — NOT WIRED, NOT REGISTERED.
 *
 * workato_schema_derive — same endpoint as workato_run_soql
 * (POST /utils/sample_to_schema.json), but the tool returns only
 * result.schema (the field definitions in the same shape Workato writes into
 * extended_output_schema on actions), discarding result.sample (rows).
 *
 * Useful for "what does this SObject's schema look like?" without dumping
 * up to 150 rows of data.
 *
 * Same auth, same failure modes as workato_run_soql.
 */
export const PLANNED_SCHEMA_DERIVE_NOTES = true;
