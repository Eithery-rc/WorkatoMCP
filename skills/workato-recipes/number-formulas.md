# Number formulas

Methods that work on integer and float datapills.

## Arithmetic operators

`+`, `-`, `*`, `/`, `**`, `%` (see `operators-and-comparison.md`). Result type follows the most precise operand.

- `4 + 7` → `11` (Fixnum)
- `4.0 + 7` → `11.0` (Float)
- `4 / 7` → `0` (integer division truncates)
- `4.0 / 7` → `0.5714...`
- `5 ** 3` → `125`
- `7 % 4` → `3`

**Gotcha**: integer/integer is integer division: cast one side with `.to_f` for decimal results.

## Absolute value / sign

### `.abs`

Absolute value. `-45.abs` → `45`; `-45.67.abs` → `45.67`.

## Rounding

### `.round(precision=0)`

Banker-rounds to `precision` decimal places; negative `precision` rounds left of decimal.

- `1234.567.round` → `1235`
- `1234.567.round(2)` → `1234.57`
- `1234.567.round(-2)` → `1200`

### `.ceil(precision=0)` / `.floor(precision=0)`

Round up / down.

- `1234.567.ceil` → `1235`; `1234.567.ceil(2)` → `1234.57`
- `1234.567.floor` → `1234`; `1234.567.floor(2)` → `1234.56`
- Gotcha: `ceil`/`floor` follow the **sign**: `-1234.567.ceil` → `-1234`, `-1234.567.floor` → `-1235`.

## Parity

### `.even?` / `.odd?`

Parity check on integers. `1234.even?` → `true`; `123.odd?` → `true`.

## Truthiness

### `.blank?` / `.present?` / `.presence`

Same semantics as strings; numbers (including `0`) are **not** blank.

- `123.present?` → `true`
- `0.blank?` → `false`
- `nil.presence` → `nil`; `0.presence` → `0`

## Conversion

### `.to_f` / `.to_i`

Convert to float / integer. Non-numeric strings return `0`, not an error.

- `45.to_f` → `45.0`
- `"45.67".to_f` → `45.67`
- `"Workato".to_f` → `0`
- `45.43.to_i` → `45`
- `"123".to_i` → `123`
- `"Workato".to_i` → `0`

**Gotcha**: silent `0` fallback hides parse errors: validate with `.match?(/^\d+(\.\d+)?$/)` if you need detection.

### `.to_s(format=nil)`

String form. For datetimes (not numbers) accepts `:short`, `:long`.

- `-45.67.to_s` → `"-45.67"`
- `"2020-06-05T17:13:27.000000-07:00".to_s(:short)` → `"05 Jun 17:13"`

## Formatting

### `.to_currency(opts)`

See string-formulas.md (same options). Works directly on numbers.

- `345.60.to_currency` → `"$345.60"`
- `345.60.to_currency(unit: "€", precision: 2)` → `"€345.60"`

### `.to_phone(opts)`

Formats digits as a phone number. See string-formulas.md.

- `1235551234.to_phone` → `"123-555-1234"`
- `1235551234.to_phone(area_code: true)` → `"(123) 555-1234"`

### `.ordinalize`

English ordinal. `1.ordinalize` → `"1st"`; `21.ordinalize` → `"21st"`; `3.ordinalize` → `"3rd"`.
