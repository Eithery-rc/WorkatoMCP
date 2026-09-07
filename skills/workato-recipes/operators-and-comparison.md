# Operators and comparison formulas

Arithmetic, comparison, logical, and range operators available in Workato formula mode.

## Arithmetic operators

### `+`

Adds numbers, combines strings, or adds time to dates.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 + 7` -> `11`
- `"Hello " + "World"` -> `"Hello World"`
- `now + 2.days` -> timestamp 2 days from now

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-add-operator)

### `-`

Subtracts numbers, or subtracts time from dates.

- **Operand types**: integer, float, number, date_time, date, unit_of_time
- `10 - 4` -> `6`
- `"2020-01-01".to_date - 2.days` -> `"2019-12-30"`
- `4 - 7` -> `-3`

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-subtract-operator)

### `*`

Multiplies numbers, or repeats strings.

- **Operand types**: integer, float, number, string
- `4 * 7` -> `28`
- `"ha" * 3` -> `"hahaha"`

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-multiply-operator)

### `/`

Divides numbers. Integer divided by integer truncates to integer.

- **Operand types**: integer, float, number
- `4 / 7` -> `0`
- `4.0 / 7` -> `0.5714285714285714`

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-divide-operator)

### `%`

Calculates modulus (remainder of left operand divided by right operand).

- **Operand types**: integer, float, number
- `7 % 4` -> `3`
- `10 % 2` -> `0`

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-modulo-operator)

### `**`

Raises left operand to the power of right operand.

- **Operand types**: integer, float, number
- `5 ** 3` -> `125`
- `4 ** 1.5` -> `8.0`

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-exponential-operator)

## Comparison operators

All comparison operators work across numbers, strings, date/times, dates, and units of time. They return a boolean (`true` or `false`).

### `==`

Returns `true` if left operand equals right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 == 4` -> `true`
- `"a" == "b"` -> `false`
- `2.days == 48.hours` -> `true`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

### `!=`

Returns `true` if left operand does not equal right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 != 5` -> `true`
- `"a" != "a"` -> `false`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

### `<`

Returns `true` if left operand is strictly less than right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 < 7` -> `true`
- `"apple" < "banana"` -> `true`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

### `<=`

Returns `true` if left operand is less than or equal to right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 <= 4` -> `true`
- `7 <= 4` -> `false`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

### `>`

Returns `true` if left operand is strictly greater than right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `7 > 4` -> `true`
- `"banana" > "apple"` -> `true`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

### `>=`

Returns `true` if left operand is greater than or equal to right operand.

- **Operand types**: integer, float, number, string, date_time, date, unit_of_time
- `4 >= 4` -> `true`
- `3 >= 4` -> `false`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

## Range operators and membership

### `.member?(value)`

Checks whether a range contains the specified value.

- **Operand types**: range
- **Returns**: boolean
- **Params**: `value` (value to check against the range)
- `(1..100).member?(78)` -> `true`
- `(1..10).member?(15)` -> `false`

[Docs](https://docs.workato.com/formulas/other-formulas.html)

## Logical and conditional operators

### `&&` / `||` / `!`

Logical AND, OR, NOT.

- `true && false` -> `false`
- `nil || "fallback"` -> `"fallback"`
- `!true` -> `false`

### `? :` (ternary)

Inline conditional: `condition ? value_if_true : value_if_false`.

- `_dp("step.amount").to_f > 100 ? "high" : "low"`

### `&.` (safe navigation)

Supported for hash square-bracket chains: `data["a"]&.[]("b")`.
For scalars, prefer `.presence || default` or ternary guards.
