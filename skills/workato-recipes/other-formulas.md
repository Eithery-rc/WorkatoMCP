# Other formulas

Reference for helpers that do not fit string, number, date, array, or hash transformations: field-control values, ID generation, hashing, encryption, encoding, JWT, YAML, digital signatures, and safe hash-access patterns.

Source: `docs.workato.com/en/formulas/other-formulas`.

## Field-control values

These are recipe-field idioms, not transformations. They behave differently depending on whether you are in text or formula mode.

### `null`

Returns nil.

**Gotcha**: typing `null` into an action's input field does NOT clear the target field. The action sees no value at all. To actually clear the field in the destination app, flip to formula mode and use `clear`.

### `blank`

Returns an empty string (`""`). Unlike `clear`, passing `blank` does not set a field to null in the target app.

- `_dp("step.middle_name").present? ? _dp("step.middle_name") : blank`

### `clear`

Clears the value in the target app's field to null. Must be in formula mode.

- Use case: "set Marketo's Company to empty" in an update action.

### `skip`

Passes nothing to the destination app, leaving the existing value untouched. Different from `null` and `clear`.

- Use case: conditional update. `_dp("step.value").present? ? _dp("step.value") : skip` (writes value if present, otherwise leaves field untouched).

| Behavior in update actions                           | `null`           | `blank` | `clear` | `skip` |
| ---------------------------------------------------- | ---------------- | ------- | ------- | ------ |
| Sends a "clear this field" instruction to the target | ❌               | ❌      | ✅      | ❌     |
| Leaves existing target value untouched               | ❌ (sends empty) | ❌      | ❌      | ✅     |
| Requires formula mode                                | ❌               | ❌      | ✅      | ✅     |

## ID and random byte generation

### `uuid` / `workato.uuid`

Generates a UUID v4. Both forms are identical.

- `uuid` -> `"c52d735a-aee4-4d44-ba1e-bcfa3734f553"`
- `workato.uuid` -> `"c52d735a-aee4-4d44-ba1e-bcfa3734f553"`

### `workato.random_bytes(length)`

Generates a string of cryptographically strong pseudo-random bytes.

- **Params**: `length` (number of bytes, maximum 32)
- `workato.random_bytes(16)`
- `workato.random_bytes(32).encode_hex`

## Hashing / message digests

### `encode_sha256`

SHA-256 hash. Returns binary; chain `.to_hex` or `.encode_base64` for printable output.

- `"hello".encode_sha256.to_hex` -> hex digest string

### `encode_sha512` / `encode_sha512_256`

SHA-512 and SHA-512/256 hashing. Returns binary output.

- **Operand types**: string, binary
- **Returns**: binary
- `_dp("step.payload").encode_sha512.to_hex`
- `_dp("step.payload").encode_sha512_256.to_hex`

### `sha1`

SHA-1 hash.

- `"abcdef".sha1.encode_base64` -> `"H4rBDyPFtbwRZ72oS4M+XAV6d9I="`

### `md5_hexdigest`

MD5 hash, already hex-encoded.

- `"hello".md5_hexdigest` -> `"5d41402abc4b2a76b9719d911017c592"`

### `hmac_sha256(key)` / `hmac_sha1(key)` / `hmac_sha512(key)` / `hmac_md5(key)`

HMAC signature using specified hash algorithm. `key` is a string.

- `"username:password:nonce".hmac_sha256("key")` (useful for API signing)

## Digital signatures (RSA)

### `rsa_sha256(key)` / `rsa_sha512(key)`

Creates an RSA-SHA256 or RSA-SHA512 digital signature using a private RSA key.

- **Operand types**: string, binary
- **Returns**: binary
- **Params**: `key` (private RSA PEM key)
- `"username:nonce".rsa_sha256("PEM key").to_hex`
- `"username:nonce".rsa_sha512("PEM key").to_hex`

### `workato.verify_rsa(payload, key, algorithm, signature)`

Verifies an RSA signature against payload and public key.

- **Params**: `payload` (signed data string), `key` (public RSA PEM key), `algorithm` (e.g. `'SHA256'`), `signature`
- **Returns**: boolean
- `workato.verify_rsa("payload data", "PEM key", "SHA256", _dp("signature"))`

## Key derivation

### `workato.pbkdf2_hmac_sha1(string, salt, iterations, length)`

Password-based key derivation function using HMAC-SHA1 pseudo-random generator.

- **Params**: `string` (password), `salt`, `iterations`, `length`
- `workato.pbkdf2_hmac_sha1("password", "salt", 1000, 32)`

## Encryption

### `encrypt(plaintext, secret_key)`

Encrypts with AES-256-CBC, RNCryptor V3 format, base64-encoded output.

- `encrypt(_dp("ssn"), _dp("encryption_key"))`
- Never hardcode keys. Use environment properties with `key` or `password` in the property name so values are masked in logs.

### `decrypt(ciphertext, secret_key)`

Reverses `encrypt`. Returns a byte array by default. Chain `.as_utf8` or `.as_string('utf-8')` to get a string.

- `decrypt(_dp("encrypted_ssn"), _dp("encryption_key")).as_utf8` -> plaintext string

### `workato.aes_cbc_encrypt(data, key, iv)` / `workato.aes_cbc_decrypt(string, key, iv)`

AES encryption and decryption using CBC mode with explicit key and IV.

- **Params**: `data` or `string` (input text), `key` (secret key), `iv` (initialization vector)
- Returns encrypted or decrypted string.

### `workato.aes_gcm_encrypt(data, key, iv, auth_data=nil)` / `workato.aes_gcm_decrypt(string, key, iv, auth_tag, auth_data=nil)`

AES authenticated encryption and decryption using GCM mode.

- **Params**: `data` or `string` (input text), `key` (secret key), `iv` (initialization vector), `auth_tag` (for decrypt), `auth_data` (optional additional authenticated data)
- Encrypt returns encrypted string and auth tag. Decrypt returns decrypted string.

## Encoding / decoding

All work on strings unless noted. Decoders return byte arrays unless they specifically produce a string.

### `.encode_base64` / `.decode_base64`

Base64 encoding and decoding.

- `"Hello World!".encode_base64` -> `"aGVsbG8gd29ybGQh"`
- `"aGVsbG8gd29ybGQh".decode_base64.as_utf8` -> `"Hello World!"`

### `.encode_urlsafe_base64` / `.decode_urlsafe_base64`

URL-safe Base64 encoding and decoding.

- `"Hello World".encode_urlsafe_base64` -> `"SGVsbG8gV29ybGQ="`
- `"SGVsbG8gV29ybGQ".decode_urlsafe_base64.as_utf8` -> `"Hello World"`

### `.encode_url` / `.decode_url`

URL component encoding and decoding.

- `"Hello World".encode_url` -> `"Hello%20World"`
- `"https%3A%2F%2Fworkato.com".decode_url` -> `"https://workato.com"`

### `.encode_hex` / `.decode_hex` / `.to_hex`

Hexadecimal encoding and decoding.

- `"0101010101011010".encode_hex` -> `"30313031303130313031303131303130"`
- `"30313031303130313031303131303130".decode_hex` -> `"0101010101011010"`
- `bytes.to_hex` (used on a byte array, e.g. `decode_base64.to_hex`)

### `.as_utf8` / `.as_string(encoding)`

Decodes a byte array into a string.

- `.as_utf8`: decode as UTF-8 (most common)
- `.as_string('utf-8')` / `.as_string('ascii')`: decode in any encoding

## Binary data checks

### `.binary?`

Checks whether a value is a binary byte array.

- **Operand types**: binary, string
- **Returns**: boolean
- `_dp("payload").binary?` -> `true`

## JWT

### `workato.jwt_encode(payload, key, algorithm, **options)`

Encodes a JWT. Algorithms: `RS256`, `RS384`, `RS512`, `HS256`, `HS384`, `HS512`, `ES256`, `ES384`, `ES512`.

- `workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS256')` -> `"eyJhbGciO..."`
- `workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS512', kid: "24668")` (`kid` becomes a header field)
- HS* algorithms take a symmetric secret string; RS*/ES* take a PEM-formatted key.

### `workato.jwt_decode(token, key, algorithm)`

Decodes and verifies JWT. Returns `{ payload: {...}, header: {...} }`.

- `workato.jwt_decode("eyJhbGciO...", "PEM key", 'RS256')`
- `workato.jwt_decode("eyJhbGciO...", "my$ecretK3y", 'HS256')`

## YAML

### `workato.parse_yaml(yaml_string)`

Parses YAML into a hash, array, or scalar. Supports true, false, nil, numbers, strings, arrays, hashes.

- `workato.parse_yaml("---\nfoo: bar")` -> `{ "foo" => "bar" }`
- `workato.parse_yaml("---\n- 1\n- 2\n- 3\n")` -> `[1, 2, 3]`

**Note**: This is the only documented YAML/JSON parser in formulas. There is no `JSON.parse` equivalent.

### `workato.render_yaml(object)`

Serializes to YAML.

- `workato.render_yaml({ "foo" => "bar" })` -> `"---\nfoo: bar\n"`
- `workato.render_yaml([1, 2, 3])` -> `"---\n- 1\n- 2\n- 3\n"`

## Hash square-bracket access (chained)

### `hash["key"]["nested"]`

Direct chain access on hashes. Raises `NoMethodError` if any intermediate key is missing (unlike `.dig` which returns `nil`).

### `hash["a"]&.[]("b")&.[]("c")` (safe-navigation form)

Workato's docs explicitly recommend safe-navigation for chained `[]` access:

> "Use the safe navigation operator `&.` instead: `data["a"]&.[]("b")&.[]("c")` returns `nil` if any chain element is `nil`."

Safe navigation `&.` is allowed for the `[]` method on hashes per Workato documentation. Other uses (`value&.upcase` on a possibly-nil scalar) are not reliable; `.dig`, `.presence || default`, and ternary remain safer choices for portability. See `formula-mode.md` for per-context detail.

**Alternative**: `hash.dig("a", "b", "c")` always returns `nil` on miss, no `&.` needed. Preferred unless you specifically need bracket syntax.

## Cross-references

- `data_table_lookup` / `lookup` / `lookup_table` -> see `lookup-formulas.md`.
- Hash transformations (`.compact`, `.except`, `.slice`, `.merge`, `.dig`) -> see `complex-data-types.md`.
- String `.encode(encoding)` -> see `string-formulas.md`.
