# Complex data types (hash / nested objects)

Methods for working with hashes (Workato calls them objects) and nested data — including JSON / XML / CSV / URL conversion and nil-safety patterns when `&.` is unavailable.

## Hash access

### `hash["key"]` / `hash[:key]`

Index access on a hash datapill. Symbol and string keys are interchangeable inside formulas.

- `_dp("step.user")["email"]`
- `user[:email]`

### `.dig("a", "b", "c")`

Safe nested access — returns `nil` if any intermediate key is missing, instead of raising.

- `response.dig("data", "user", "email")` → either the value or `nil`
- Equivalent to (and replaces) `response["data"]["user"]["email"]` when intermediate keys may not exist

**Gotcha**: `.dig` is the formula-mode replacement for `&.`-style traversal — use it freely for nil-safe lookups.

## Hash transformation

### `.compact`

Removes keys whose value is `nil`. Does not remove `false`, `""`, or `0`.

- `{a: 1, b: nil, c: 2}.compact` → `{a: 1, c: 2}`

### `.except("k1", "k2")`

Returns a copy without the named keys.

- `{a: 1, b: 2, c: 3}.except("b")` → `{a: 1, c: 3}`

### `.slice("k1", "k2")`

Returns a copy keeping only the named keys.

- `{a: 1, b: 2, c: 3}.slice("a", "c")` → `{a: 1, c: 3}`

### `.merge(other_hash)`

Merge two hashes; right side wins on conflict.

- `{a: 1}.merge({b: 2})` → `{a: 1, b: 2}`
- `{a: 1}.merge({a: 99})` → `{a: 99}`

### `.keys` / `.values`

Lists of keys / values.

- `{a: 1, b: 2}.keys` → `["a", "b"]`
- `{a: 1, b: 2}.values` → `[1, 2]`

### `.length` / `.size` / `.count`

Number of key/value pairs.

### `.empty?`

True if no keys. Equivalent to `.blank?` for hashes.

## Pluck on arrays of hashes

`.pluck("field")` is listed in `array-formulas.md`; mirror it here for cross-reference:

- `users.pluck("email")` → array of email strings
- `users.pluck("first_name", "last_name")` → array of `[first, last]` tuples
- `users.pluck("address.city")` — **not supported**; pluck only accesses top-level keys. Use `.format_map("%{address.city}")` to drill into nested.

## Serialization

### `.to_json`

Hash → JSON string. Allowed at encode side; **parse is not** — there is no `JSON.parse` in formulas.

- `{a: 1, b: [2, 3]}.to_json` → `'{"a":1,"b":[2,3]}'`

### `.to_xml(root: "name")`

Hash → XML. Optional `root:` overrides the wrapping element.

### `.from_xml`

String → hash. **Available on String**, not on Hash.

- `"<root><a>1</a></root>".from_xml` → `{"root" => {"a" => "1"}}`

### `.to_param` / `.encode_www_form`

Hash → URL-encoded query string. Both methods produce identical output.

- `{a: 1, b: 2}.to_param` → `"a=1&b=2"`
- `{filter: "x y"}.to_param` → `"filter=x+y"`

### `.to_csv`

Array → CSV row. Not directly available on hash; use `.values.to_csv` for hash row.

- `{a: 1, b: 2}.values.to_csv` → `"1,2\n"`

## Type conversion across containers

| From            | To               | Method                                       |
| --------------- | ---------------- | -------------------------------------------- |
| Hash            | JSON string      | `.to_json`                                   |
| JSON string     | Hash             | **Not available** — use a JSON-parser action |
| Hash            | XML string       | `.to_xml`                                    |
| XML string      | Hash             | `.from_xml`                                  |
| Hash            | URL-encoded form | `.to_param` / `.encode_www_form`             |
| Array of arrays | CSV row          | `.to_csv`                                    |

**Gotcha**: There is no in-formula JSON parser. If your HTTP-connector response field is a string, deserialize it in a recipe step (JSON-parse action or `body` projection), not inside a formula.

## Nil-safety patterns (no `&.` operator)

Workato bans the safe-navigation operator (`value&.upcase`), so use these patterns instead:

### Ternary on `.present?`

```ruby
_dp("step.email").present? ? _dp("step.email").upcase : nil
```

### `.presence` + `||`

```ruby
_dp("step.email").presence || "fallback@example.com"
```

`.presence` returns the value if `present?`, else `nil`, making `||` defaulting work.

### Default-via-`.dig` chain

```ruby
response.dig("user", "email") || "unknown"
```

`.dig` already returns `nil` for missing keys — no need to guard each step.

### Boolean default

```ruby
flag.presence || false
```

## Common patterns

```ruby
# Build JSON body, dropping nil fields
{
  name: _dp("trigger.name"),
  email: _dp("trigger.email"),
  phone: _dp("trigger.phone")
}.compact.to_json

# Nested lookup with default
response.dig("data", "attributes", "name") || "Untitled"

# URL query string from a hash
{ q: _dp("step.query"), page: 1 }.to_param

# Pick only specific keys before serializing
user.slice("id", "email", "name").to_json

# Merge defaults under user input (user wins)
{ status: "open", priority: "normal" }.merge(input_hash)
```
