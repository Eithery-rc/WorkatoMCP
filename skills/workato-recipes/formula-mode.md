# Formula mode basics + common patterns + gotchas

## Text mode vs formula mode

Workato input fields run in one of two modes:

- **Text mode** maps datapills and literal text directly; whatever you type renders verbatim. Ruby string interpolation (`#{expr}`) is **not** supported in text mode.
- **Formula mode** is enabled by clicking the **Formula** (`fx`) button on the field; the background tints to indicate the switch. The field is parsed as a single Ruby-like expression that must evaluate to the field's expected type.

In the recipe code-tree JSON, a formula-mode input value is prefixed with `=`, e.g. `"input": {"message": "=_dp('...').upcase"}`. Text-mode values either have no prefix or use `#{_dp(...)}` interpolation.

## Datapill syntax inside formulas

Datapills inside formula mode are written as Ruby identifiers, **not** as `#{...}` interpolations. In Workato's internal pill helper, a datapill is referenced as `_dp("step.path")` and methods chain onto it:

```
_dp("trigger.email").downcase.strip
_dp("step1.amount").to_f.round(2)
_dp("step1.tags").join(", ")
```

The pseudo-globals `now`, `today`, `nil`, integer literals, and string literals are also valid starting expressions.

## Allowlist behavior

Formula mode runs against an allowlist of Ruby methods. From the Workato docs: _"Ruby methods not found in Workato documentation are not allowlisted and, therefore, not supported."_ Adding new methods requires a request through a Customer Success Manager.

What's **not** in the allowlist:

- `eval`, `instance_eval`, `class_eval`, `module_eval`
- `send`, `__send__`, `method_missing`, `define_method`
- File I/O (`File.read`, `open`, `IO.popen`)
- Network calls (`Net::HTTP`, sockets)
- Shell-out: `` `cmd` ``, `system`, `exec`
- Environment access (`ENV[...]`)
- `JSON.parse` (encoder `.to_json` IS allowed; parser is not)
- Blocks: `array.map { |x| ... }`, `.select { ... }`, `.each_with_object`, `.reduce { ... }`
- String interpolation in plain string literals: `"hi #{name}"` — banned in both text mode and formula mode. **Exception**: `#{...}` interpolation IS allowed inside regex literals — see the "Common patterns" section below.
- Note: safe-navigation `&.` for **hash square-bracket chains** (`hash["a"]&.[]("b")`) IS documented as supported (see `other-formulas.md`). General `value&.upcase` on scalars is unreliable — prefer `.dig` for nested hashes and `.presence || default` / ternary for scalars.

## Common patterns

```ruby
# Default value (turns "" into nil so || fires)
_dp("trigger.name").presence || "Unknown"

# Conditional value (standard ternary)
_dp("step1.amount").to_f > 100 ? "high" : "low"

# Trim + lowercase email
_dp("trigger.email").to_s.strip.downcase

# Parse a date string and reformat
_dp("trigger.created").to_date(format: "MM/DD/YYYY").strftime("%Y-%m-%d")

# Date math against now (SLA deadline 7 days out)
_dp("ticket.created_at").to_time + 7.days

# CSV of selected fields from a list of hashes
contacts.pluck("email").smart_join(", ")

# JSON body for an HTTP action
{ name: _dp("trigger.name"), tags: tags.uniq }.to_json

# Filter then project
_dp("step1.records").where('status': 'active').pluck("id")

# Multi-line string (concatenate, embed literal \n — NO interpolation)
"Line 1\n" + _dp("step.body")

# Cast then format as currency
_dp("step.amount").to_f.round(2).to_currency(unit: "€", precision: 2)

# Epoch seconds (UTC) from a datetime pill
_dp("step.created_at").to_time.to_i

# Guard against nil with ternary (no &. operator)
_dp("step.email").present? ? _dp("step.email").upcase : nil
```

## Not supported / gotchas

- **Allowlist only.** Any Ruby method not in the formula docs is rejected at edit time. No escape hatch.
- **No I/O of any kind.** File reads/writes, network sockets, environment access, shell-out are all blocked. Network calls must go through HTTP-connector actions, not formulas.
- **No `#{...}` interpolation in plain string literals.** `"hi #{name}"` is rejected. Build strings with `+`, `<<`, `.join`, `.format_map`, `.smart_join`.
- **Exception: regex literals.** `#{...}` interpolation DOES work inside `/.../`. Useful for dynamic patterns:
  - `_dp("payload").to_s.scan(/^.*#{_dp("notice_id")}.*$/).first` — find first line containing a dynamic id (no parsing step needed).
  - Likely composes with `/i`, `/m` modifiers and applies to `.match` / `.match?` / `.gsub` / `.sub` / `.split` taking a regex — verify empirically before relying on a specific combination.
- **No blocks.** Use `.pluck`, `.where`, `.format_map`, `.uniq`, `.compact`, `.smart_join` instead. For row-by-row transformation, use a recipe Repeat step.
- **Safe-navigation `&.` is partially supported.** Workato docs explicitly endorse it for hash bracket chains: `hash["a"]&.[]("b")&.[]("c")`. General `value&.upcase` on scalars is **not** documented as supported — for portability use `.dig(...)` on hashes and `.presence || default` / ternary on scalars. `nil.upcase` raises at runtime, so guard before calling.
- **`now` and `today` default to US/Pacific**, not UTC. Always pass `.in_time_zone("UTC")` or `.in_time_zone(nil)` for portable timestamps. Bare `.utc` is not allowlisted — use `.in_time_zone(nil)`.
- **Integer division silently truncates.** `4 / 7` is `0`; cast with `.to_f` for decimals.
- **`.to_f` / `.to_i` on non-numeric strings returns `0`**, not an error. Validate with `.match?(/^\d+$/)` first if you need to detect bad input.
- **`.where` with two operators on the same key**: only the last wins. Use chained `.where(...).where(...)` instead.
- **`.to_s` on a list cannot be used inside a Repeat step's iterator** — pluck/join into a real string first.
- **`.encode` raises** if a character cannot be represented in the target encoding (e.g. `"Olé".encode("ASCII")`). Use `.transliterate` first.
- **No `JSON.parse` in formulas.** To deserialize JSON, use a JSON-parser action/trigger from a connector; the formula sandbox only goes one way (`.to_json`).
- **`#{...}` is banned in text mode too** (post-update); fields that need expressions must be flipped to formula mode explicitly.
- **New methods require allowlist request.** Contact the workspace's Customer Success Manager to extend.
