# Array / list formulas

Methods that work on lists / arrays of values (often arrays of hashes from a recipe step's output).

## Indexing

### `.first` / `.last`

Element at index 0 / -1. `nil` on empty arrays — does not raise.

- `[1, 2, 3].first` → `1`
- `[1, 2, 3].last` → `3`
- `[].first` → `nil`

### `.first(n)` / `.last(n)`

First / last `n` elements.

- `[1, 2, 3, 4].first(2)` → `[1, 2]`
- `[1, 2, 3, 4].last(2)` → `[3, 4]`

### `.index(value)`

Zero-based index of first matching element; `nil` if not found.

- `["a", "b", "c"].index("b")` → `1`
- `["a", "b", "c"].index("z")` → `nil`

## Size / counts

### `.length` / `.size` / `.count`

Number of elements. All three are equivalent on arrays.

- `[1, 2, 3].length` → `3`

### `.count(value)`

Count of occurrences of `value`.

- `["a", "b", "a"].count("a")` → `2`

## Truthiness

### `.blank?` / `.present?`

`[]` is `blank?`; any non-empty array (even of nils) is `present?`.

- `[].blank?` → `true`; `[nil].blank?` → `false`
- `[].present?` → `false`; `[nil].present?` → `true`

### `.include?(value)` / `.exclude?(value)`

Membership check.

- `[1, 2, 3].include?(2)` → `true`
- `[1, 2, 3].exclude?(4)` → `true`

## Filtering (arrays of hashes)

### `.where(field: value)` / `.where(field: [v1, v2])` / `.where('field': '>=', value)`

SQL-like filter on arrays of hashes. Returns matching rows.

- `users.where(active: true)` → rows where `active == true`
- `users.where(status: ["new", "active"])` → IN-clause
- `orders.where('amount': '>=', 100)` → comparison
- Chain to combine: `.where(a: 1).where(b: 2)`

**Gotcha**: `.where(amount: '>=', value)` with two operators on same key — only the last wins. Use chained `.where(...).where(...)`.

## Projection (arrays of hashes)

### `.pluck("field")` / `.pluck("a", "b")`

Extract a single column or multiple columns from an array of hashes.

- `users.pluck("email")` → `["a@x.com", "b@x.com"]`
- `users.pluck("first_name", "last_name")` → `[["Jean","Marie"], ...]`

### `.format_map(template)`

Per-row string format using `%{field}` placeholders (no `#{...}` because interpolation is banned).

- `users.format_map("%{first_name} <%{email}>")` → `["Jean <a@x.com>", ...]`

## Combination / reordering

### `.concat(other_array)`

Append elements of another array.

- `[1, 2].concat([3, 4])` → `[1, 2, 3, 4]`

### `.reverse`

Reverse element order.

- `[1, 2, 3].reverse` → `[3, 2, 1]`

### `.uniq`

Deduplicate (first-occurrence wins).

- `[1, 2, 2, 3].uniq` → `[1, 2, 3]`

### `.flatten` / `.flatten(depth)`

Flatten nested arrays. No-arg flattens fully.

- `[[1, 2], [3, [4]]].flatten` → `[1, 2, 3, 4]`
- `[[1, 2], [3, [4]]].flatten(1)` → `[1, 2, 3, [4]]`

### `.compact`

Remove `nil` elements (but keeps `false`, `""`, `0`).

- `[1, nil, 2, nil].compact` → `[1, 2]`

### `-` (difference)

Set difference: elements in left not in right.

- `[1, 2, 3] - [2]` → `[1, 3]`

## Aggregation

### `.sum`

Sum of numeric elements. `[1, 2, 3].sum` → `6`.

### `.max` / `.min`

Largest / smallest element by natural ordering.

- `[3, 1, 2].max` → `3`; `[3, 1, 2].min` → `1`

## Joining to strings

### `.join(sep="")`

Concatenate elements with `sep`. No arg → no separator.

- `["a", "b", "c"].join(", ")` → `"a, b, c"`
- `[1, 2, 3].join` → `"123"`

### `.smart_join(sep)`

Like `.join` but **drops nil and empty-string elements first** — useful for optional CSV columns.

- `["a", nil, "", "b"].smart_join(",")` → `"a,b"`

## Serialization

### `.to_csv`

CSV row from array of scalars.

- `["a", "b,c", 3].to_csv` → `"a,\"b,c\",3\n"`

### `.to_json`

JSON encoding. Allowed at the **encode** end of the sandbox; `JSON.parse` is **not** allowed.

- `[1, 2, 3].to_json` → `"[1,2,3]"`
- `[{a: 1}].to_json` → `"[{\"a\":1}]"`

### `.to_xml(root: "items")`

XML serialization (optional root element name).

### `.from_xml`

Parse XML string into a hash. **Available on strings, not arrays.**

### `.encode_www_form` / `.to_param`

URL-form-encode an array of `[key, value]` pairs (or a hash).

- `[["a", 1], ["b", 2]].encode_www_form` → `"a=1&b=2"`
- `{a: 1, b: 2}.to_param` → `"a=1&b=2"`

## Common patterns

```ruby
# All emails from active users, deduped, comma-separated
users.where(active: true).pluck("email").uniq.smart_join(", ")

# First 5 records' IDs as JSON array
records.first(5).pluck("id").to_json

# Sum of order amounts
orders.pluck("amount").sum

# Comma-separated tags, skipping blanks
tags.compact.smart_join(", ")

# Boolean: any user is admin?
users.where(role: "admin").present?
```
