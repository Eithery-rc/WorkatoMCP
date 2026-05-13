# String formulas

Methods that work on String datapills (and chain off any expression that evaluates to a String).

## Truthiness / emptiness checks

### `.blank?`

True if input is nil, empty string, whitespace-only, false, or NaN.

- `"".blank?` → `true`
- `"Any Value".blank?` → `false`
- Gotcha: `0.blank?` is false; `false.blank?` is true.

### `.is_true?`

True if value evaluates to true. Accepts `"true"`, `"t"`, `"yes"`, `"y"`, `"1"`.

- `true.is_true?` → `true`; `0.is_true?` → `false`
- Gotcha: empty string raises an error.

### `.is_not_true?`

Inverse of `is_true?`. `true.is_not_true?` → `false`; `false.is_not_true?` → `true`.

### `.present?`

True if not nil, not false, not empty string, not empty list.

- `"Any Value".present?` → `true`; `"".present?` → `false`
- Gotcha: a list containing only nils is still `present?` → `true`; only `[]` is false.

### `.presence`

Returns the value itself if `present?`, otherwise `nil`. Useful for `||` defaulting:
`_dp("x").presence || "default"`.

## Substring / pattern matching

### `.include?(substring)`

Case-sensitive substring check. `"Partner account".include?("Partner")` → `true`. `"Partner account".include?("partner")` → `false`.

### `.exclude?(substring)`

Inverse of `include?`. `"Partner account".exclude?("partner")` → `true`.

### `.match?(regex)`

True if regex matches anywhere in the string. `"Jean Marie".match?(/Marie/)` → `true`. Regex literal with forward slashes; case-sensitive unless `/i` modifier used.

### Dynamic regex patterns — `#{...}` interpolation inside `/.../`

Even though `#{...}` interpolation is banned in plain string literals, it **is** allowed inside regex literals. This is the cleanest way to build a pattern that depends on a datapill.

- `_dp("payload").to_s.scan(/^.*#{_dp("notice_id")}.*$/).first` — first line in a multi-line payload containing a dynamic id (verified on AdPay Load MVP recipe 72436887).
- `text.match?(/^#{_dp("prefix")}/)` — startswith check on a dynamic prefix.
- Works with regex modifiers: `/.../i`, `/.../m`.
- Also documented/expected to work on `.match`, `.gsub(/regex/, ...)`, `.sub(/regex/, ...)`, `.split(/regex/)` — verify empirically when relying on a specific combination.
- **Gotcha**: interpolated content is **not** automatically regex-escaped. If the datapill could contain `. ( ) [ ] | + * ? \\`, those will be interpreted as regex metacharacters. There is no `Regexp.escape` in the formula allowlist; if you need literal matching, fall back to `.include?(...)` instead.

### `.starts_with?(prefix)` / `.ends_with?(suffix)`

Case-sensitive prefix/suffix. `"Jean Marie".starts_with?("Jean")` → `true`. `"Jean Marie".ends_with?("RIE")` → `false`. Chain with `.downcase` for case-insensitive.

## Whitespace / normalization

### `.lstrip` / `.rstrip` / `.strip`

Trim whitespace from left / right / both ends. `" Test ".strip` → `"Test"`. Does not collapse interior whitespace — use `.gsub(/\s+/, " ")` for that.

### `.parameterize`

Replaces non-ASCII characters with ASCII equivalents (for URL slugs / strict APIs). `"öüâ".parameterize` → `"oua"`.

### `.transliterate`

ASCII approximation of unicode characters. `"Chloé".transliterate` → `"Chloe"`. Less aggressive than `parameterize`.

### `.scrub(replacement)`

Replaces invalid byte sequences in the string. `"abcあ\x81".scrub("*")` → `"abcあ*"`.

### `.strip_tags`

Removes all HTML tags. `"<p>Jean Marie</p>".strip_tags` → `"Jean Marie"`.

## Padding / alignment

### `.ljust(length, pad=" ")` / `.rjust(length, pad=" ")`

Pad string to `length` chars on the right / left. `"test".ljust(10, "*")` → `"test******"`. `"test".rjust(10, "*")` → `"******test"`.

### `.reverse`

Reverses character order. `"Jean Marie".reverse` → `"eiraM naeJ"`.

## Substitution / replacement

### `.gsub(find, replace)`

Replaces **all** occurrences. Accepts string or regex pattern.

- `"I have a blue house and a blue car".gsub("blue", "red")` → `"I have a red house and a red car"`
- `"Jean Marie".gsub(/[Jr]/, "M")` → `"Mean MaMie"`

### `.sub(find, replace)`

Replaces only the **first** occurrence. `"Mean Marie".sub(/M/, "J")` → `"Jean Marie"`.

## Inspection / slicing

### `.length`

Character count (includes whitespace). `"Jean Marie".length` → `10`.

### `.slice(start, length)`

Substring at zero-indexed `start` for `length` chars. Negative `start` counts from the end.

- `"Jean Marie".slice(0, 3)` → `"Jea"`
- `"Jean Marie".slice(-5, 5)` → `"Marie"`

### `.scan(regex)`

Array of all regex matches.

- `"Thu, 01/23/2014".scan(/\d+/)` → `["01","23","2014"]`
- Chain: `"Thu, 01/23/2014".scan(/\d+/).join("-")` → `"01-23-2014"`

### `.split(separator=" ")`

Splits into an array. No-arg splits on whitespace.

- `"Ms-Jean-Marie".split("-")` → `["Ms", "Jean", "Marie"]`
- `"Ms Jean Marie".split` → `["Ms", "Jean", "Marie"]`

## Encoding

### `.encode(encoding)`

Re-encodes the string. `"Jean Marie".encode("Windows-1252")` → `"Jean Marie"`. Raises if a char can't be represented (e.g. `"Olé".encode("ASCII")`).

### `.bytes` / `.bytesize` / `.byteslice(start, len)`

Byte-level access — useful for multi-byte (CJK) strings.

- `"Hello".bytes` → `[72, 101, 108, 108, 111]`
- `"Hello".bytesize` → `5`
- `"abc漢字".byteslice(0, 4)` → `"abc漢"`

## Case transformation

### `.capitalize`

First char uppercase, rest lowercase. `"jean MARIE".capitalize` → `"Jean marie"`.

### `.titleize`

First letter of every word uppercase. `"jean MARIE".titleize` → `"Jean Marie"`.

### `.upcase` / `.downcase`

Uppercase / lowercase the entire string.

- `"Automation at its FINEST!".upcase` → `"AUTOMATION AT ITS FINEST!"`
- `"Automation at its FINEST!".downcase` → `"automation at its finest!"`

### `.quote`

Escapes embedded single quotes (SQL-safe). `"Paula's Baked Goods".quote` → `"Paula''s Baked Goods"`.

## Conversion / formatting

### `.to_s`

String conversion. Accepts `:short` / `:long` format symbol for datetimes.

- `-45.67.to_s` → `"-45.67"`
- `[1, 2, 3].to_s` → `"[1, 2, 3]"`
- Gotcha: `.to_s` on a list result cannot be used inside repeat steps.

### `.ordinalize`

English ordinal string. `1.ordinalize` → `"1st"`; `3.ordinalize` → `"3rd"`.

### `.to_country_alpha2` / `.to_country_alpha3` / `.to_country_name`

Convert between ISO 3166 country codes and names.

- `"GBR".to_country_alpha2` → `"GB"`
- `"GB".to_country_alpha3` → `"GBR"`
- `"GBR".to_country_name` → `"United Kingdom"`

### `.to_currency(opts)`

Formats number as currency string. Options: `unit`, `format`, `precision`, `separator`, `delimiter`, `negative_format`.

- `"345.60".to_currency` → `"$345.60"`
- `"345.60".to_currency(unit: "€")` → `"€345.60"`

### `.to_currency_code` / `.to_currency_name` / `.to_currency_symbol`

- `"GBR".to_currency_code` → `"GBP"`
- `"GBR".to_currency_name` → `"Pound"`
- `"GBR".to_currency_symbol` → `"£"`

### `.to_phone(opts)`

Formats digits as a phone number. Options: `area_code`, `delimiter`, `extension`, `country_code`.

- `"5551234".to_phone` → `"555-1234"`
- `1235551234.to_phone(area_code: true)` → `"(123) 555-1234"`

### `.to_state_code` / `.to_state_name`

US-state code ↔ name conversion.

- `"California".to_state_code` → `"CA"`
- `"CA".to_state_name` → `"CALIFORNIA"`
