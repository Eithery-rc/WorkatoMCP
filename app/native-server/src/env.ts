/**
 * Environment overrides.
 *
 * Every variable the bridge reads is MOKUTAB_<NAME>. The WORKATOMCP_<NAME> it
 * replaced in 2.0 is still read when the new one is unset or blank, until 3.0,
 * so a machine set up for 1.x keeps its overrides.
 */

export const ENV_PREFIX = 'MOKUTAB_';
/** The 1.x prefix, read as a fallback. */
export const LEGACY_ENV_PREFIX = 'WORKATOMCP_';

/** The WORKATOMCP_<NAME> a MOKUTAB_<NAME> replaced, or null for any other name. */
export function legacyEnvName(name: string): string | null {
  return name.startsWith(ENV_PREFIX) ? LEGACY_ENV_PREFIX + name.slice(ENV_PREFIX.length) : null;
}

/**
 * The value of `name` (a MOKUTAB_* name), else of the WORKATOMCP_* name it
 * replaced; undefined when neither holds anything but whitespace. Returned
 * untrimmed, as the variable holds it.
 */
export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  if (value !== undefined && value.trim() !== '') return value;
  const legacy = legacyEnvName(name);
  const fallback = legacy ? env[legacy] : undefined;
  return fallback !== undefined && fallback.trim() !== '' ? fallback : undefined;
}
