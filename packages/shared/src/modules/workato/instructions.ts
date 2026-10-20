/**
 * The Workato part of the server instructions, sent at initialize while the
 * module is on. It names tools only, never their parameters: the schema is the
 * documentation. The budget for core plus every module is checked in the
 * bridge (server-identity.test.ts).
 */
export const WORKATO_INSTRUCTIONS = [
  'Workato: which app exists, its adapter name -> workato_apps_list(query);',
  "an adapter's actions and field names -> workato_adapter_meta;",
  "a step's real extended_*_schema, never hand-written -> workato_step_schema;",
  'one field to change -> workato_recipe_set_input_path;',
  'several edits or a structural change -> workato_recipe_apply;',
  'find a value in a recipe -> workato_recipe_grep, then read that path;',
  'inspect a job -> workato_job_trace with paths;',
  'find jobs -> workato_list_jobs with started_from/started_to or match, not paging;',
  'who calls a recipe -> workato_recipe_callers;',
  'can a recipe still authenticate -> workato_recipe_connections;',
  'what a change would break -> workato_recipe_validate;',
  'a save that stops and restarts callers -> workato_recipe_save_with_dependents,',
  'then workato_operation_status on timeout;',
  'run a fixture through a recipe -> workato_test_recipe;',
  'which workspace a call lands in -> workato_session_context;',
  'change environment or client workspace -> workato_switch_environment;',
  'deploy -> workato_deploy_plan, review its diff, then workato_deploy_run.',
].join(' ');
