# Workato formula reference index

Index of all 169 formula-mode functions and operators supported by Workato. Any method or operator absent from this index is not in the allowlist and will be rejected at edit time.

To refresh: capture the response of `GET https://app.workato.com/web_api/formula_suggestions.json` and regenerate.

## Operators and comparison (`operators-and-comparison.md`)

- `!=` -> `operators-and-comparison.md`
- `%` -> `operators-and-comparison.md`
- `*` -> `operators-and-comparison.md`
- `**` -> `operators-and-comparison.md`
- `+` -> `operators-and-comparison.md`
- `-` -> `operators-and-comparison.md`
- `/` -> `operators-and-comparison.md`
- `<` -> `operators-and-comparison.md`
- `<=` -> `operators-and-comparison.md`
- `==` -> `operators-and-comparison.md`
- `>` -> `operators-and-comparison.md`
- `>=` -> `operators-and-comparison.md`
- `member?` -> `operators-and-comparison.md`

## String formulas (`string-formulas.md`)

- `blank?` -> `string-formulas.md`
- `bytes` -> `string-formulas.md`
- `bytesize` -> `string-formulas.md`
- `byteslice` -> `string-formulas.md`
- `capitalize` -> `string-formulas.md`
- `downcase` -> `string-formulas.md`
- `encode` -> `string-formulas.md`
- `ends_with?` -> `string-formulas.md`
- `exclude?` -> `string-formulas.md`
- `gsub` -> `string-formulas.md`
- `include?` -> `string-formulas.md`
- `is_not_true?` -> `string-formulas.md`
- `is_true?` -> `string-formulas.md`
- `length` -> `string-formulas.md`
- `ljust` -> `string-formulas.md`
- `lstrip` -> `string-formulas.md`
- `match?` -> `string-formulas.md`
- `ordinalize` -> `string-formulas.md`
- `parameterize` -> `string-formulas.md`
- `presence` -> `string-formulas.md`
- `present?` -> `string-formulas.md`
- `quote` -> `string-formulas.md`
- `rjust` -> `string-formulas.md`
- `rstrip` -> `string-formulas.md`
- `scan` -> `string-formulas.md`
- `scrub` -> `string-formulas.md`
- `split` -> `string-formulas.md`
- `starts_with?` -> `string-formulas.md`
- `strip` -> `string-formulas.md`
- `strip_tags` -> `string-formulas.md`
- `sub` -> `string-formulas.md`
- `titleize` -> `string-formulas.md`
- `to_country_alpha2` -> `string-formulas.md`
- `to_country_alpha3` -> `string-formulas.md`
- `to_country_name` -> `string-formulas.md`
- `to_currency` -> `string-formulas.md`
- `to_currency_code` -> `string-formulas.md`
- `to_currency_name` -> `string-formulas.md`
- `to_currency_symbol` -> `string-formulas.md`
- `to_phone` -> `string-formulas.md`
- `to_s` -> `string-formulas.md`
- `to_state_code` -> `string-formulas.md`
- `to_state_name` -> `string-formulas.md`
- `transliterate` -> `string-formulas.md`
- `unicode_normalize` -> `string-formulas.md`
- `unpack` -> `string-formulas.md`
- `upcase` -> `string-formulas.md`

## Number formulas (`number-formulas.md`)

- `abs` -> `number-formulas.md`
- `ceil` -> `number-formulas.md`
- `even?` -> `number-formulas.md`
- `floor` -> `number-formulas.md`
- `odd?` -> `number-formulas.md`
- `round` -> `number-formulas.md`
- `to_f` -> `number-formulas.md`
- `to_i` -> `number-formulas.md`

## Date and time formulas (`date-formulas.md`)

- `ago` -> `date-formulas.md`
- `beginning_of_day` -> `date-formulas.md`
- `beginning_of_hour` -> `date-formulas.md`
- `beginning_of_month` -> `date-formulas.md`
- `beginning_of_week` -> `date-formulas.md`
- `beginning_of_year` -> `date-formulas.md`
- `days` -> `date-formulas.md`
- `dst?` -> `date-formulas.md`
- `end_of_month` -> `date-formulas.md`
- `from_now` -> `date-formulas.md`
- `hours` -> `date-formulas.md`
- `in_time_zone` -> `date-formulas.md`
- `minutes` -> `date-formulas.md`
- `months` -> `date-formulas.md`
- `now` -> `date-formulas.md`
- `seconds` -> `date-formulas.md`
- `strftime` -> `date-formulas.md`
- `to_date` -> `date-formulas.md`
- `to_time` -> `date-formulas.md`
- `today` -> `date-formulas.md`
- `utc` -> `date-formulas.md`
- `wday` -> `date-formulas.md`
- `weeks` -> `date-formulas.md`
- `yday` -> `date-formulas.md`
- `years` -> `date-formulas.md`
- `yweek` -> `date-formulas.md`

## Array and list formulas (`array-formulas.md`)

- `compact` -> `array-formulas.md`
- `drop` -> `array-formulas.md`
- `find_index` -> `array-formulas.md`
- `first` -> `array-formulas.md`
- `flatten` -> `array-formulas.md`
- `format_map` -> `array-formulas.md`
- `index` -> `array-formulas.md`
- `join` -> `array-formulas.md`
- `last` -> `array-formulas.md`
- `max` -> `array-formulas.md`
- `min` -> `array-formulas.md`
- `minmax` -> `array-formulas.md`
- `pack` -> `array-formulas.md`
- `pluck` -> `array-formulas.md`
- `reverse` -> `array-formulas.md`
- `slice_after` -> `array-formulas.md`
- `slice_before` -> `array-formulas.md`
- `smart_join` -> `array-formulas.md`
- `sum` -> `array-formulas.md`
- `take` -> `array-formulas.md`
- `uniq` -> `array-formulas.md`
- `where` -> `array-formulas.md`
- `zip` -> `array-formulas.md`

## Complex data types (`complex-data-types.md`)

- `encode_www_form` -> `complex-data-types.md`
- `except` -> `complex-data-types.md`
- `from_xml` -> `complex-data-types.md`
- `slice` -> `complex-data-types.md`
- `to_csv` -> `complex-data-types.md`
- `to_json` -> `complex-data-types.md`
- `to_param` -> `complex-data-types.md`
- `to_xml` -> `complex-data-types.md`

## Lookup formulas (`lookup-formulas.md`)

- `data_table_lookup` -> `lookup-formulas.md`
- `lookup` -> `lookup-formulas.md`
- `lookup_table` -> `lookup-formulas.md`

## Other formulas (cryptography, encoding, system) (`other-formulas.md`)

- `as_string` -> `other-formulas.md`
- `as_utf8` -> `other-formulas.md`
- `binary?` -> `other-formulas.md`
- `blank` -> `other-formulas.md`
- `clear` -> `other-formulas.md`
- `decode_base64` -> `other-formulas.md`
- `decode_hex` -> `other-formulas.md`
- `decode_url` -> `other-formulas.md`
- `decode_urlsafe_base64` -> `other-formulas.md`
- `decrypt` -> `other-formulas.md`
- `encode_base64` -> `other-formulas.md`
- `encode_hex` -> `other-formulas.md`
- `encode_sha256` -> `other-formulas.md`
- `encode_sha512` -> `other-formulas.md`
- `encode_sha512_256` -> `other-formulas.md`
- `encode_url` -> `other-formulas.md`
- `encode_urlsafe_base64` -> `other-formulas.md`
- `encrypt` -> `other-formulas.md`
- `hmac_md5` -> `other-formulas.md`
- `hmac_sha1` -> `other-formulas.md`
- `hmac_sha256` -> `other-formulas.md`
- `hmac_sha512` -> `other-formulas.md`
- `md5_hexdigest` -> `other-formulas.md`
- `null` -> `other-formulas.md`
- `rsa_sha256` -> `other-formulas.md`
- `rsa_sha512` -> `other-formulas.md`
- `sha1` -> `other-formulas.md`
- `skip` -> `other-formulas.md`
- `to_hex` -> `other-formulas.md`
- `workato.aes_cbc_decrypt` -> `other-formulas.md`
- `workato.aes_cbc_encrypt` -> `other-formulas.md`
- `workato.aes_gcm_decrypt` -> `other-formulas.md`
- `workato.aes_gcm_encrypt` -> `other-formulas.md`
- `workato.jwt_decode` -> `other-formulas.md`
- `workato.jwt_encode` -> `other-formulas.md`
- `workato.parse_yaml` -> `other-formulas.md`
- `workato.pbkdf2_hmac_sha1` -> `other-formulas.md`
- `workato.random_bytes` -> `other-formulas.md`
- `workato.render_yaml` -> `other-formulas.md`
- `workato.uuid` -> `other-formulas.md`
- `workato.verify_rsa` -> `other-formulas.md`
