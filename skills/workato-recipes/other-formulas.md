# Other formulas

Reference for helpers that don't fit string / number / date / array / hash transformations — field-control values, ID generation, hashing, encryption, encoding, JWT, YAML, and the safe hash-access pattern.

Source: `docs.workato.com/en/formulas/other-formulas`.

## Field-control values

These are recipe-field idioms, not transformations. They behave differently depending on whether you're in text or formula mode.

### `null`

Returns nil.

**Gotcha**: typing `null` into an action's input field does NOT clear the target field — the action sees no value at all. To actually clear the field in the destination app, flip to formula mode and use `clear`.

### `clear`

Clears the value in the **target app's field** to null. Must be in formula mode.

- Use case: "set Marketo's Company to empty" in an update action.

### `skip`

Passes nothing to the destination app — leaves the existing value untouched. Different from `null` and `clear`.

- Use case: conditional update. `_dp("step.value").present? ? _dp("step.value") : skip` — write value if present, otherwise don't touch the field.

| Behavior in update actions                           | `null`           | `clear` | `skip` |
| ---------------------------------------------------- | ---------------- | ------- | ------ |
| Sends a "clear this field" instruction to the target | ❌               | ✅      | ❌     |
| Leaves existing target value untouched               | ❌ (sends empty) | ❌      | ✅     |
| Requires formula mode                                | ❌               | ✅      | ✅     |

## ID generation

### `uuid`

Generates a UUID v4.

- `uuid` → `"c52d735a-aee4-4d44-ba1e-bcfa3734f553"`

## Hashing / message digests

### `encode_sha256`

SHA-256 hash. Returns binary; chain `.to_hex` / `.encode_base64` for printable.

- `"hello".encode_sha256.to_hex` → hex digest string

### `sha1`

SHA-1 hash.

- `"abcdef".sha1.encode_base64` → `"H4rBDyPFtbwRZ72oS4M+XAV6d9I="`

### `md5_hexdigest`

MD5, already hex-encoded.

- `"hello".md5_hexdigest` → `"5d41402abc4b2a76b9719d911017c592"`

### `hmac_sha256(key)` / `hmac_sha1(key)` / `hmac_sha512(key)` / `hmac_md5(key)`

HMAC signature. `key` is a string.

- `"username:password:nonce".hmac_sha256("key")` — useful for API signing

## Encryption (AES-256-CBC, RNCryptor V3)

### `encrypt(plaintext, secret_key)`

Encrypts with AES-256-CBC, RNCryptor V3 format, base64-encoded output.

- `encrypt(_dp("ssn"), _dp("encryption_key"))`
- **Never hardcode keys.** Use [environment properties](#environment-properties) with `key` or `password` in the property name so the value is masked in logs.

### `decrypt(ciphertext, secret_key)`

Reverses `encrypt`. Returns a **byte array** by default — chain `.as_utf8` or `.as_string('utf-8')` to get a string.

- `decrypt(_dp("encrypted_ssn"), _dp("encryption_key")).as_utf8` → plaintext string

## Encoding / decoding

All work on strings unless noted. Decoders return byte arrays unless they specifically produce a string.

### Base64

- `"Hello World!".encode_base64` → `"aGVsbG8gd29ybGQh"`
- `"aGVsbG8gd29ybGQh".decode_base64.as_utf8` → `"Hello World!"`

### URL-safe Base64

- `"Hello World".encode_urlsafe_base64` → `"SGVsbG8gV29ybGQ="`
- `"SGVsbG8gV29ybGQ".decode_urlsafe_base64` → `"Hello World"`

### URL encoding

- `"Hello World".encode_url` → `"Hello%20World"`
- `"https%3A%2F%2Fworkato.com".decode_url` → `"https://workato.com"`

### Hex

- `"0101010101011010".encode_hex` → `"30313031303130313031303131303130"`
- `"30313031303130313031303131303130".decode_hex` → `"0101010101011010"`
- `bytes.to_hex` — used on a byte array (e.g. `decode_base64.to_hex`)

### Byte array → string

- `.as_utf8` — decode as UTF-8 (most common)
- `.as_string('utf-8')` / `.as_string('ascii')` — decode in any encoding

## JWT

### `workato.jwt_encode(payload, key, algorithm, **options)`

Encodes a JWT. Algorithms: `RS256` / `RS384` / `RS512` / `HS256` / `HS384` / `HS512` / `ES256` / `ES384` / `ES512`.

- `workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS256')` → `"eyJhbGciO..."`
- `workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS512', kid: "24668")` — `kid` becomes a header field
- HS* algorithms take a symmetric secret string; RS*/ES\* take a PEM-formatted key.

### `workato.jwt_decode(token, key, algorithm)`

Decodes and verifies. Returns `{ payload: {...}, header: {...} }`.

- `workato.jwt_decode("eyJhbGciO...", "PEM key", 'RS256')`
- `workato.jwt_decode("eyJhbGciO...", "my$ecretK3y", 'HS256')`

## YAML

### `workato.parse_yaml(yaml_string)`

Parses YAML into a hash/array/scalar. Supports true/false/nil/numbers/strings/arrays/hashes.

- `workato.parse_yaml("---\nfoo: bar")` → `{ "foo" => "bar" }`
- `workato.parse_yaml("---\n- 1\n- 2\n- 3\n")` → `[1, 2, 3]`

**Note**: This is the only documented YAML/JSON **parser** in formulas — there is no `JSON.parse` equivalent.

### `workato.render_yaml(object)`

Serializes to YAML.

- `workato.render_yaml({ "foo" => "bar" })` → `"---\nfoo: bar\n"`
- `workato.render_yaml([1, 2, 3])` → `"---\n- 1\n- 2\n- 3\n"`

## Hash square-bracket access (chained)

### `hash["key"]["nested"]`

Direct chain access on hashes. **Raises `NoMethodError` if any intermediate key is missing** — unlike `.dig` which returns `nil`.

### `hash["a"]&.[]("b")&.[]("c")` — safe-navigation form

Workato's docs explicitly recommend safe-navigation for chained `[]` access:

> "Use the safe navigation operator `&.` instead: `data["a"]&.[]("b")&.[]("c")` returns `nil` if any chain element is `nil`."

So `&.` **is allowed** for the `[]` method on hashes — at least per the docs. Other uses (`value&.upcase` on a possibly-nil scalar) may or may not parse; `.dig`, `.presence || default`, and ternary remain safer choices for portability. See `formula-mode.md` for the per-context detail.

**Alternative**: `hash.dig("a", "b", "c")` — always returns `nil` on miss, no `&.` needed, parses everywhere. **Preferred** unless you specifically need bracket syntax.

## Cross-references

- `data_table_lookup` / `lookup` / `lookup_table` → see `lookup-formulas.md`.
- Hash transformations (`.compact`, `.except`, `.slice`, `.merge`, `.dig`) → see `complex-data-types.md`.
- String `.encode(encoding)` (different from `.encode_*` here — that's character-set re-encoding, not algorithmic encoding) → see `string-formulas.md`.
