---
name: workato-formulas
description: Use when constructing or reviewing Workato recipe formulas — string/number/date/array transformations, `_dp(...)` datapill chains, `=`-prefixed formula-mode expressions, conditional or null-safety patterns. Workato's formula sandbox is a Ruby allowlist (no `eval`/IO/blocks/interpolation); this skill lists what's actually available.
---

# Workato formulas — index

Workato recipe input fields run in **text mode** (literal text + raw datapills) or **formula mode** (`=`-prefixed; field is parsed as a Ruby-like expression against an allowlist). This skill is a category-indexed reference for the methods agents may legally chain inside formula mode.

Load the file matching the data type of the value you're transforming:

| File                    | When                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formula-mode.md`       | Always read first — explains text-vs-formula, datapill syntax, what's banned, and the common patterns (default-via-`.presence`, ternary, type-conversion chains). |
| `string-formulas.md`    | Working on a string datapill: trimming, casing, regex, parsing, slugs, currencies.                                                                                |
| `number-formulas.md`    | Integer/float math, rounding, casting, currency/phone formatting.                                                                                                 |
| `date-formulas.md`      | `now`/`today`, `.strftime`, `.in_time_zone`, date math (`+ N.days`), epoch ↔ datetime.                                                                            |
| `array-formulas.md`     | Arrays of hashes: `.where`, `.pluck`, `.compact`, `.flatten`, `.join`/`.smart_join`.                                                                              |
| `complex-data-types.md` | Hash ops, JSON/XML/CSV/URL encoding, nil-safety patterns.                                                                                                         |

## Critical rules (always apply)

1. **Allowlist only.** If a method isn't in these files, it's blocked — including `eval`, `send`, `JSON.parse`, file/network IO.
2. **No blocks.** `array.map { ... }`, `.select { ... }`, `.reduce { ... }` won't parse. Use `.pluck` / `.where` / `.format_map` / `.smart_join` instead. For per-row logic use a Repeat step in the recipe.
3. **No string interpolation.** `"hi #{name}"` is rejected. Build strings with `+`, `.join`, `.format_map`.
4. **No safe-navigation.** `value&.upcase` won't parse — use `value.presence` + `||` or a ternary.
5. **Default `now`/`today` are US/Pacific**, not UTC. Add `.in_time_zone("UTC")` (or `.in_time_zone(nil)`) for portable timestamps.
6. **Integer division truncates**: `4 / 7 == 0`. Cast with `.to_f` first if you want decimals.
7. **`.to_i`/`.to_f` on non-numeric strings return `0`**, not an error. Validate with `.match?(/^\d+$/)` if you need failure detection.

Full gotcha list and patterns are in `formula-mode.md`.

Related: [[workato-recipe-schemas]] for where these formulas slot into the recipe code tree (`input.message`, `if.input.conditions[].lhs`, `foreach.source`, etc.).
