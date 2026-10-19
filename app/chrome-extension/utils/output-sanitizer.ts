/** The sanitizer lives in workatomcp-shared: the bridge redacts with the same rules. */
export {
  DEFAULT_MAX_OUTPUT_BYTES,
  RAW_MAX_OUTPUT_BYTES,
  formatRawOutput,
  isSensitiveKey,
  sanitizeAndLimitOutput,
  sanitizeText,
  type OutputSanitizerOptions,
  type SanitizedOutput,
} from 'workatomcp-shared';
