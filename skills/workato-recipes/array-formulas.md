# Array / list formulas

Methods that work on lists / arrays of values (often arrays of hashes from a recipe step's output).

## Indexing

### `.first` / `.last`

Element at index 0 / -1. Returns `nil` on empty arrays without raising an error.

- `[1, 2, 3].first` -> `1`
- `[1, 2, 3].last` -> `3`
- `[].first` -> `nil`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.first(n)` / `.last(n)`

First / last `n` elements.

- `[1, 2, 3, 4].first(2)` -> `[1, 2]`
- `[1, 2, 3, 4].last(2)` -> `[3, 4]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.take(n)` / `.drop(n)`

Returns or skips the first `n` elements of a list.

- **Operand types**: array
- **Params**: `n` (number of elements to return or drop)
- `["book", "apple", "cart"].take(2)` -> `["book", "apple"]`
- `["book", "apple", "cart"].drop(1)` -> `["apple", "cart"]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.index(value)` / `.find_index(value)`

Zero-based index of first matching element. Returns `nil` if not found.

- **Operand types**: array
- **Params**: `value` (element to locate)
- `["a", "b", "c"].index("b")` -> `1`
- `["a", "b", "c"].find_index("b")` -> `1`
- `["a", "b", "c"].index("z")` -> `nil`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Size / counts

### `.length` / `.size` / `.count`

Number of elements. All three are equivalent on arrays.

- `[1, 2, 3].length` -> `3`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.count(value)`

Count of occurrences of `value`.

- `["a", "b", "a"].count("a")` -> `2`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Truthiness

### `.blank?` / `.present?`

Empty array `[]` is `blank?`. Any non-empty array (even of nils) is `present?`.

- `[].blank?` -> `true`
- `[nil].blank?` -> `false`
- `[].present?` -> `false`
- `[nil].present?` -> `true`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.include?(value)` / `.exclude?(value)`

Membership check.

- `[1, 2, 3].include?(2)` -> `true`
- `[1, 2, 3].exclude?(4)` -> `true`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Filtering (arrays of hashes)

### `.where(field: value)` / `.where(field: [v1, v2])` / `.where('field': '>=', value)`

SQL-like filter on arrays of hashes. Returns matching rows.

- `users.where(active: true)` -> rows where `active == true`
- `users.where(status: ["new", "active"])` -> IN-clause
- `orders.where('amount': '>=', 100)` -> comparison
- Chain to combine: `.where(a: 1).where(b: 2)`

**Gotcha**: `.where(amount: '>=', value)` with two operators on the same key keeps only the last operator. Use chained `.where(...).where(...)` instead.

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Projection (arrays of hashes)

### `.pluck("field")` / `.pluck("a", "b")`

Extract a single column or multiple columns from an array of hashes.

- `users.pluck("email")` -> `["a@x.com", "b@x.com"]`
- `users.pluck("first_name", "last_name")` -> `[["Jean","Marie"], ...]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.format_map(template)`

Per-row string format using `%{field}` placeholders (no interpolation syntax).

- `users.format_map("%{first_name} <%{email}>")` -> `["Jean <a@x.com>", ...]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Combination / reordering

### `.concat(other_array)`

Appends elements of another array.

- `[1, 2].concat([3, 4])` -> `[1, 2, 3, 4]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.reverse`

Reverses element order.

- `[1, 2, 3].reverse` -> `[3, 2, 1]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.uniq`

Deduplicates elements (first occurrence wins).

- `[1, 2, 2, 3].uniq` -> `[1, 2, 3]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.flatten` / `.flatten(depth)`

Flattens nested arrays. Calling without arguments flattens completely.

- `[[1, 2], [3, [4]]].flatten` -> `[1, 2, 3, 4]`
- `[[1, 2], [3, [4]]].flatten(1)` -> `[1, 2, 3, [4]]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.compact`

Removes `nil` elements (keeps `false`, `""`, and `0`).

- `[1, nil, 2, nil].compact` -> `[1, 2]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.zip(*other_arrays)`

Merges elements of the array with corresponding elements from each argument array.

- **Operand types**: array
- **Params**: one or more arrays to combine with
- `[1, 2].zip(["a", "b"])` -> `[[1, "a"], [2, "b"]]`
- `[1, 2].zip(["a", "b"], ["x", "y"])` -> `[[1, "a", "x"], [2, "b", "y"]]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.slice_before(value)` / `.slice_after(value)`

Splits a list into groups before or after a matching value. Returns an enumerator, best converted using `.to_a`.

- **Operand types**: array
- **Params**: `value` (element to match)
- `[1, 2, 3, 4].slice_before(3).to_a` -> `[[1, 2], [3, 4]]`
- `[1, 2, 3, 4].slice_after(2).to_a` -> `[[1, 2], [3, 4]]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `-` (difference)

Set difference: elements in left array that are not in right array.

- `[1, 2, 3] - [2]` -> `[1, 3]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Aggregation

### `.sum`

Sum of numeric elements.

- `[1, 2, 3].sum` -> `6`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.max` / `.min`

Largest or smallest element by natural ordering.

- `[3, 1, 2].max` -> `3`
- `[3, 1, 2].min` -> `1`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.minmax`

Returns a two-element array with the smallest and largest value in the list `[min, max]`.

- **Operand types**: array
- `[3, 1, 5, 2].minmax` -> `[1, 5]`
- `["apple", "pear", "banana"].minmax` -> `["apple", "pear"]`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Joining to strings

### `.join(sep="")`

Concatenates elements with `sep`. Calling without arguments uses no separator.

- `["a", "b", "c"].join(", ")` -> `"a, b, c"`
- `[1, 2, 3].join` -> `"123"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.smart_join(sep)`

Like `.join`, but drops nil and empty-string elements first. Useful for optional CSV columns.

- `["a", nil, "", "b"].smart_join(",")` -> `"a,b"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

## Serialization

### `.to_csv`

Generates a CSV row from an array of scalars.

- `["a", "b,c", 3].to_csv` -> `"a,\"b,c\",3\n"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.to_json`

JSON encoding. Allowed for encoding; note that `JSON.parse` is not allowed.

- `[1, 2, 3].to_json` -> `"[1,2,3]"`
- `[{a: 1}].to_json` -> `"[{\"a\":1}]"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.to_xml(root: "items")`

XML serialization with optional root element name.

- `[1, 2].to_xml(root: "numbers")`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.from_xml`

Parses XML string into a hash. Available on strings, not arrays.

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.encode_www_form` / `.to_param`

URL-form-encodes an array of `[key, value]` pairs (or a hash).

- `[["a", 1], ["b", 2]].encode_www_form` -> `"a=1&b=2"`
- `{a: 1, b: 2}.to_param` -> `"a=1&b=2"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

### `.pack(template)`

Packs the contents of an array into a binary sequence according to directive format template.

- **Operand types**: array
- **Returns**: string
- **Params**: `template` (format directive string such as `"c*"` or `"H*"`)
- `[65, 66, 67].pack("c*")` -> `"ABC"`

[Docs](https://docs.workato.com/formulas/array-list-formulas.html)

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
