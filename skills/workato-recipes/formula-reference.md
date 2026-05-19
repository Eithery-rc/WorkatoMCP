# Workato formula reference

Exhaustive catalog of every function and operator Workato offers in formula mode — generated from the recipe editor's `formula_suggestions.json` endpoint (169 entries). The category files (`string-formulas.md`, `date-formulas.md`, etc.) give task-oriented guidance; this file is the complete lookup.

**Find a formula:** grep by name, or by a word in its _Tags_ line. **Check a formula:** confirm the name appears here, then match your call against _Operand types_, _Params_, and _Examples_. If a method is not in this file it is not in the allowlist — Workato will reject it (see `formula-mode.md`).

_To refresh: capture the response of `GET https://app.workato.com/web_api/formula_suggestions.json` and regenerate._

---

## -

Subtract numbers, subtract time from dates.

**Operator** · **Operand types:** integer, float, number, date_time, date, unit_of_time

**Examples:**

```ruby
#{_('sample.workato.action.payRate')} - 1.25
#{_('sample.workato.action.CreatedDate')} - 2.days
4-7 #-3
4.0-7 #-3.0
4-7.0 #-3.0
4.0-7.0 #-3.0
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-subtract-operator)

---

## !=

Returns true if the left operand is not equal to the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 != 4 #false
7.days != 3.days #true
"a" != "b" #true
```

---

## \*

Multiply numbers, repeat strings.

**Operator** · **Operand types:** integer, float, number, string

**Examples:**

```ruby
#{_('sample.workato.action.amount')} * 0.20
4*7 #28
4.0*7 #28.0
4*7.0 #28.0
4.0*7.0 #28.0
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-multiply-operator)

---

## \*\*

Returns the value of the left operand to the power of the right operand.

**Operator** · **Operand types:** integer, float, number

**Examples:**

```ruby
#{_('sample.workato.action.interest')}**#{_('sample.workato.action.period')}
5**3 #125
4**1.5 #8.0
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-exponential-operator)

---

## /

Divide numbers.

**Operator** · **Operand types:** integer, float, number

**Examples:**

```ruby
#{_('sample.workato.action.TotalOpportunityQuantity')} / #{_('sample.workato.action.Amount')}
#{_('sample.workato.action.Amount')} / 10.0
4/7 #0
4.0/7 #0.571428...
4/7.0 #0.571428...
4.0/7.0 #0.571428...
7.0/4.0 #1.75
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-divide-operator)

---

## %

Modulus of two numbers. Returns remainder of left operand divided by right operand.

**Operator** · **Operand types:** integer, float, number

**Examples:**

```ruby
#{_('sample.workato.action.age')} % 5
4%7 #4
4.0%7 #4.0
4%7.0 #4.0
4.0%7.0 #4.0
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-modulo-operator)

---

## +

Add numbers, combine strings, add time to dates.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
#{_('sample.workato.action.payRate')} + 1.25
#{_('sample.workato.action.firstName')} + '  ' + #{_('sample.workato.action.lastName')}
#{_('sample.workato.action.CreatedDate')} + 2.days
4+7 #11
4.0+7 #11.0
4+7.0 #11.0
4.0+7.0 #11.0
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#the-add-operator)

---

## <

Returns true if the left operand is less than the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 < 4 #false
7.days < 3.days #false
"a" < "b" #true
```

---

## <=

Returns true if the left operand is less than or equal to the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 <= 4 #true
7.days <= 3.days #false
"a" <= "b" #true
```

---

## ==

Returns true if the left operand is equal to the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 == 4 #true
7.days == 3.days #false
"a" == "b" #false
```

---

## >

Returns true if the left operand is greater than the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 > 4 #false
7.days > 3.days #true
"a" > "b" #false
```

---

## >=

Returns true if the left operand is greater than or equal to the right operand.

**Operator** · **Operand types:** integer, float, number, string, date_time, date, unit_of_time

**Examples:**

```ruby
4 >= 4 #true
7.days >= 3.days #true
"a" >= "b" #false
```

---

## abs

Returns the absolute value of number.

**Category:** number · **Operand types:** number, float, integer

**Examples:**

```ruby
#{_('sample.workato.action.credit')}.abs
-145.abs #145
-45.0.abs #45.0
-45.67.abs #45.67
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#abs)

---

## ago

Go back by a specified time duration.

**Category:** date · **Operand types:** unit_of_time · **Returns:** date_time

> You can use any of these units: seconds, minutes, hours, days, months, or years.

**Examples:**

```ruby
2.days.ago #2020-01-15T12:30:00.000000-07:00 if time now is 2020-01-17T12:30:00.000000-07:00
30.minutes.ago #2020-01-15T12:30:00.000000-07:00 if time now is 2020-01-15T13:00:00.000000-07:00
30.seconds.ago #2020-01-15T12:30:00.000000-07:00 if time now is 2020-01-15T12:30:30.000000-07:00
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#ago)

_Tags: long back, back, time, date_

---

## as_string

Decode byte sequence as string in given encoding.

**Category:** string · **Operand types:** binary · **Returns:** string

**Params:**

- `encoding` — encoding to use

**Examples:**

```ruby
"0J/RgNC40LLQtdGC
".decode_base64.as_string('utf-8')
"0J/RgNC40LLQtdGC
".decode_base64.as_utf8
```

---

## as_utf8

Decode byte sequence as UTF-8 string.

**Category:** string · **Operand types:** binary · **Returns:** string

**Examples:**

```ruby
"0J/RgNC40LLQtdGC
".decode_base64.as_string('utf-8')
"0J/RgNC40LLQtdGC
".decode_base64.as_utf8
```

---

## beginning_of_day

Returns timestamp for midnight on date of given date/timestamp.

**Category:** date · **Operand types:** date, date_time · **Returns:** date

**Examples:**

```ruby
"2020-06-08T22:30:10.000000-07:00".to_time.beginning_of_day #"2020-06-08T00:00:00.000000-07:00"
"2020-01-10T01:30:45.000000-00:00".to_date.beginning_of_day #"2020-01-10T00:00:00.000000-00:00"
#{_('sample.workato.action.createdAt')}.beginning_of_day #"2020-06-08T00:00:00.000000-00:00"
#{_('sample.workato.action.lastModifiedAt')}.beginning_of_day #"2020-09-05T00:00:00.000000-05:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#beginning-of-day)

---

## beginning_of_hour

Returns timestamp for top-of-the-hour for given timestamp.

**Category:** date · **Operand types:** date_time · **Returns:** date_time

**Examples:**

```ruby
"2020-06-01T16:56:00.000000-07:00".to_time.beginning_of_hour #"2020-06-01T16:00:00.000000-07:00"
"2020-06-01T12:15:00.000000-00:00".to_time.beginning_of_hour #"2020-06-01T12:00:00.000000-00:00"
#{_('sample.workato.action.createdAt')}.beginning_of_hour #"2020-06-01T16:00:00.000000-00:00"
#{_('sample.workato.action.lastModifiedAt')}.beginning_of_hour #"2020-09-06T20:00:00.000000-05:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#beginning-of-hour)

---

## beginning_of_month

Returns date for start of month for given date/timestamp.

**Category:** date · **Operand types:** date, date_time · **Returns:** date

**Examples:**

```ruby
"2020-01-30T22:35:00.000000-07:00".to_time.beginning_of_month #"2020-01-01T00:00:00.000000-07:00"
"2020-06-15T22:35:00.000000-00:00".to_date.beginning_of_month #"Mon, 01 Jun 2020"
#{_('sample.workato.action.createdAt')}.beginning_of_month #"2020-06-01T00:00:00.000000-00:00"
#{_('sample.workato.action.lastModifiedAt')}.beginning_of_month #"2020-09-01T00:00:00.000000-05:00"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#capitalize)

---

## beginning_of_week

Returns date for start of week (Mon) for given date/timestamp.

**Category:** date · **Operand types:** date, date_time · **Returns:** date

**Examples:**

```ruby
"2020-08-18T00:00:00.000000-07:00".to_time.beginning_of_week #"2020-08-14T00:00:00.000000-07:00"
"2020-08-20T00:00:00.000000-00:00".to_date.beginning_of_week #"Mon, 17 Aug 2020"
#{_('sample.workato.action.created_at')}.beginning_of_week #"2020-08-31T00:00:00.000000-00:00"
#{_('sample.workato.action.created_at')}.to_date.beginning_of_week #"Mon, 31 Aug 2020"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#beginning-of-week)

---

## beginning_of_year

Returns date for start of year for given date/timestamp.

**Category:** date · **Operand types:** date, date_time · **Returns:** date

**Examples:**

```ruby
"2020-01-25T00:00:00.000000-07:00".to_time.beginning_of_year #"2020-01-01T00:00:00.000000-07:00"
"2020-12-25T22:30:00.000000-00:00".to_date.beginning_of_year #"Wed, 01 Jan 2020"
#{_('sample.workato.action.created_at')}.beginning_of_year #"2010-01-01T00:00:00.000000-05:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#beginning-of-year)

---

## binary?

Is the value a binary array? Returns true or false.

**Category:** conditional · **Operand types:** binary, string · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.Payload')}.binary?
```

---

## blank

Gives an empty string value. Note: Passing this into an input field will not update the field value as null. Use the clear formula to update a field value to null.

**Examples:**

```ruby
#{_('sample.workato.action.MiddleName')}.present? ? #{_('sample.workato.action.MiddleName')} : blank
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#blank)

---

## blank?

Check if the data is empty.

**Category:** conditional · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.AccountType')}.blank?
"".blank? #true
nil.blank? #true
"123".blank? #false
"0".blank? #false
```

[Docs](https://docs.workato.com/formulas/{{ string|number|date }}-formulas.html#blank)

---

## bytes

Returns an array of bytes for a given string.

**Category:** string · **Operand types:** string, binary

**Examples:**

```ruby
"Hello".bytes # [72, 101, 108, 108, 111]
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#bytes)

---

## bytesize

Returns the length of a given string in bytes.

**Category:** string · **Operand types:** string

**Examples:**

```ruby
"Hello".bytesize # 5
"Hello World".bytesize # 11
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#bytesize)

---

## byteslice

Returns a substring of specified bytes. Supports non-ASCII/multiple byte characters(e.g., Japanese, Chinese).

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `position` — Zero based index of the string to slice from.
- `length` — Defaults to 1. The length of bytes in the returned substring.

> Use negative numbers to search from the end of the list.

**Examples:**

```ruby
"helloworld".byteslice(5,3) #"wor"
"helloworld".byteslice(-3) #"r"
"helloworld".byteslice(-7,3) #"low"
```

_Tags: slice, substring_

---

## capitalize

Convert text to sentence case.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.capitalize
"capitalize this SENTENCE".capitalize #"Capitalize this sentence"
"lower. case.".capitalize #"Lower. case."
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#capitalize)

---

## ceil

Returns the smallest number greater than or equal to float with a precision of ndigits decimal digits (default: 0).

**Category:** number · **Operand types:** number, float · **Returns:** number

**Params:**

- `ndigits` — When the precision is negative, the returned value is an integer with at least ndigits abs trailing zeros

**Examples:**

```ruby
1.2.ceil      #=> 2
2.0.ceil      #=> 2
(-1.2).ceil   #=> -1
(-2.0).ceil   #=> -2
1.234567.ceil(2)   #=> 1.24
34567.89.ceil(-2)  #=> 34600
34567.89.ceil(-1)  #=> 34570
34567.89.ceil(0)   #=> 34568
34567.89.ceil(1)   #=> 34567.9
34567.89.ceil(2)   #=> 34567.89
```

---

## clear

Clears the value of the field in the target app to null/nil.

**Examples:**

```ruby
#{_('sample.workato.action.IsVendor')} ? "Vendor" : clear #"Vendor" if #{_('sample.workato.action.IsVendor')} is true, changes the app value to null otherwise
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#clear)

---

## compact

Removes nil values from array and hash.

**Category:** array · **Operand types:** array, hash

**Examples:**

```ruby
#{_('sample.workato.action.user.phones').compact} # removes nil phones from the array
["foo", nil, "bar"].compact # ["foo", "bar"]
#{_('sample.workato.action.user.office_address').compact} # removes keys with nil values from the hash
{ foo: 1, bar: nil, baz: 2 }.compact # { foo: 1, baz: 2 }
```

---

## data_table_lookup

Lookup a record from a data table.

**Returns:** hash

**Params:**

- `folder_path` — Case sensitive path to the folder that contains the data table, using "/" as a separator
- `table_name` — Case sensitive name of the data table.
- `lookup_by` — Case sensitive name and value of lookup key. Comma-separated multiple key-value pairs.

**Examples:**

```ruby
data_table_lookup('My Project/Reference Data Tables', 'States list', 'State code': 'AZ')['State name'] #"Arizona"
data_table_lookup('My Project', 'States list', 'State name': 'Arizona')['State code'] #"AZ"
data_table_lookup('My Project', 'States list', 'State code': #{_('sample.workato.action.stateCode')})['State name'] #lookup by a field value
data_table_lookup('My Project ', 'Countries list', 'Country code': #{_('sample.workato.action.countryCode')})['Country name'] #"United States"
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#data_table_lookup)

---

## days

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.days.from_now
3.days.ago
```

---

## decode_base64

Decode using Base64 algorithm.

**Operand types:** string · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.status')}.decode_base64
```

---

## decode_hex

Decode hexadecimal into binary string.

**Operand types:** string · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.payload')}.decode_hex
```

---

## decode_url

URL decode a string.

**Operand types:** string · **Returns:** string

**Examples:**

```ruby
'https%3A%2F%2Fworkato.com%2Ffoo%3Fbar%3Dat%23anchor'.decode_url # 'https://workato.com/foo?bar=at#anchor'
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#decode-url)

---

## decode_urlsafe_base64

Decode using urlsafe modification of Base64 algorithm.

**Operand types:** string · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.status')}.decode_urlsafe_base64
```

---

## decrypt

Decrypt the enrypted string using AES-256-CBC algorithm. Input should be in RNCryptor V3 format.

**Returns:** string

**Params:**

- `input` — Encrypted string
- `key` — Decryption key

**Examples:**

```ruby
decrypt(#{_('sample.workato.action.encrypted_ssn')}, #{_('sample.workato.action.data_encryption_key')})
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#decrypt)

---

## downcase

Convert text to lowercase.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.downcase
"Convert to DOWNCASE".downcase #"convert to downcase"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#downcase)

_Tags: change case, lower case_

---

## drop

Drop the first number of elements specified and return the remainder of the list

**Category:** array · **Operand types:** array

**Params:**

- `value` — Number of elements to drop

**Examples:**

```ruby
["book", "apple", "cart"].drop(1) #["apple", "cart"]
["cat", "dog", "rat"].drop(2) #["rat"]
[-5, 0, 1, 2, 3, 4, 5].drop(4) #[3, 4, 5]
[-1.5, 1.5, 2, 3, 3.5].drop(3) #[3, 3.5]
```

---

## dst?

Returns true if the time is within Daylight Savings Time for the specified time zone.

**Category:** date · **Operand types:** date_time

> #Note: timestamps with no timezones take the timezone defined by the data center your Workato account is hosted in.

**Examples:**

```ruby
"2020-09-06T18:30:15.671720-05:00".to_time.in_time_zone("America/Los_Angeles").dst? # true
"2020-05-31T12:30:45.303136-07:00".in_time_zone("Kolkata").dst? # false
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#dst)

---

## encode

Encodes the string to given encoding.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `encoding` — Name of the encoding. Eg: Windows-1252

**Examples:**

```ruby
#{_('sample.workato.action.name')}.encode("Windows-1252")
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#encode)

---

## encode_base64

Encode using Base64 algorithm.

**Operand types:** string, binary · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.status')}.encode_base64
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#encode-base64)

---

## encode_hex

Converts binary string to its hex representation.

**Operand types:** string, binary · **Returns:** string

**Examples:**

```ruby
"0J/RgNC40LLQtdGC
".decode_base64.encode_hex
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#encode-hex)

---

## encode_sha256

Encode using SHA256 algorithm.

**Operand types:** string, binary · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.status')}.encode_sha256
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#encode-sha256)

---

## encode_sha512

Encode using SHA512 algorithm.

**Operand types:** string, binary · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.status')}.encode_sha512
```

---

## encode_sha512_256

Encode using SHA512256 algorithm.

**Operand types:** string, binary · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.status')}.encode_sha512_256
```

---

## encode_url

URL encode a string.

**Operand types:** string · **Returns:** string

**Examples:**

```ruby
'Hello World'.encode_url # 'Hello%20World'
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#encode-url)

---

## encode_urlsafe_base64

Encode using urlsafe modification of Base64 algorithm.

**Operand types:** string, binary · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.status')}.encode_urlsafe_base64
```

---

## encode_www_form

Join hash into url-encoded string of parameters.

**Operand types:** hash · **Returns:** string

**Examples:**

```ruby
{"apple" => "red green", "2" => "3"}.encode_www_form #"apple=red+green&2=3"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#encode-www-form)

---

## encrypt

Encrypt the input string using AES-256-CBC algorithm. Output is packed in RNCryptor V3 format.

**Returns:** string

**Params:**

- `input` — Input string
- `key` — Encryption key

**Examples:**

```ruby
encrypt(#{_('sample.workato.action.ssn')}, #{_('sample.workato.action.data_encryption_key')})
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#encrypt)

---

## end_of_month

Returns a new date/time representing the end of the month

**Category:** date · **Operand types:** date, date_time · **Returns:** date

**Examples:**

```ruby
"2020-08-18T00:00:00".to_time.end_of_month # => 2020-08-31 23:59:59.999999999 +0000
"2020-08-18T00:00:00".to_date.end_of_month # => Mon, 31 Aug 2020
```

---

## ends_with?

Does field end with specified pattern? Returns true or false. Case sensitive.

**Category:** string · **Operand types:** string · **Returns:** boolean

**Params:**

- `pattern` — Pattern to check string against

**Examples:**

```ruby
#{_('sample.workato.action.status')}.ends_with?("pattern")
"Hello!".ends_with?("!") #true
"Jean Marie".ends_with?("rie") #true
"Jean Marie".ends_with?("RIE") #false
"Jean Marie".upcase.ends_with?("RIE") #true
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#ends-with)

---

## even?

Returns true if integer is an even number.

**Category:** conditional, number · **Operand types:** integer · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.index')}.even? # true
#{_('sample.workato.action.percentage')}.to_i.even? # true
```

---

## except

Returns a hash that includes everything except given keys

**Operand types:** hash · **Returns:** hash

**Params:**

- `keys` — The keys to except

**Examples:**

```ruby
{ name: "Jake", last_name: "Paul", age: "22" }.except(:name, :last_name) # { :age => "22" }
```

---

## exclude?

Does field contain the value? Returns true if value not found. Case-sensitive.

**Category:** string · **Operand types:** string · **Returns:** boolean

**Params:**

- `value` — Value to check if string excludes

**Examples:**

```ruby
#{_('sample.workato.action.status')}.exclude?("value")
"Partner account".exclude?("Partner") #false
"Partner account".exclude?("partner") #true
"partner account".exclude?("partner") #false
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#exclude)

---

## find_index

Returns the index of the first object in the list that matches the value

**Category:** array · **Operand types:** array

**Params:**

- `value` — Value to match in the list

**Examples:**

```ruby
["book", "apple", "cart"].find_index("apple") #1
["cat", "dog", "rat"].find_index("cat") #0
[-5, 0, 1, 2, 3, 4, 5].find_index(4) #5
[-1.5, 1.5, 2, 3, 3.5].find_index(2) #2
```

---

## first

Get the first n items in a list.

**Category:** array · **Operand types:** array

**Params:**

- `n` — Number of items to return.

> If you don't specify "n", only the first item will be returned.
> Use negative numbers to search from the end of the list.

**Examples:**

```ruby
["Ms", "Jean", "Marie"].first #"Ms"
["Ms", "Jean", "Marie"].first(2) #["Ms", "Jean"]
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#first)

---

## flatten

Flatten a multi-dimensional array to a simple array.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
[[1, 2, 3],[4,5,6]].flatten #[1, 2, 3, 4, 5, 6]
[[1, [2, 3], 3], [4, 5, 6]].flatten #[1, 2, 3, 3, 4, 5, 6]
[[1, [2, 3], 9], [9, 8, 7]].flatten #[1, 2, 3, 9, 9, 8, 7]
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#flatten)

---

## floor

Returns the largest number less than or equal to float with a precision of ndigits decimal digits (default: 0).

**Category:** number · **Operand types:** number, float · **Returns:** number

**Params:**

- `ndigits` — When the precision is negative, the returned value is an integer with at least ndigits abs trailing zeros

**Examples:**

```ruby
1.2.floor      #=> 1
2.0.floor      #=> 2
(-1.2).floor   #=> -2
(-2.0).floor   #=> -2
1.234567.floor(2)   #=> 1.23
34567.89.floor(-2)  #=> 34500
34567.89.floor(-1)  #=> 34560
34567.89.floor(0)   #=> 34567
34567.89.floor(1)   #=> 34567.8
34567.89.floor(2)   #=> 34567.89
```

---

## format_map

Create an array of strings by formatting each row of given array.

**Category:** array · **Operand types:** array

**Params:**

- `format` — Format used to process every string in the array

**Examples:**

```ruby
[{name: 'Jake', age: 23}].format_map('Name: %{name}, Age: %{age}') #['Name: Jake, Age: 23']
[[22, 45], [33, 88]].format_map('Id: %s, Count: %s') #['Id: 22, Count: 45', 'Id: 33, Count: 88']
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#format-map)

---

## from_now

Go forward in time. Returns timestamp of the moment that the formula was executed with the specified time period added, in Pacific time (UTC-8/UTC-7).

**Category:** date · **Operand types:** unit_of_time · **Returns:** date_time

**Examples:**

```ruby
4.months.from_now #2020-05-23T14:40:07.338328-07:00
2.days.from_now #2020-01-05T14:40:07.338328-07:00
30.minutes.from_now
12.seconds.from_now
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#from-now)

---

## from_xml

Converts XML string to hash.

**Operand types:** string · **Returns:** hash

**Examples:**

```ruby
"<?xml version=\"1.0\" encoding=\"UTF-8\"?> <hash><foo type=\"integer\">1</foo></hash>".from_xml
             # {"hash" => ["foo" => [{ "@type" => "integer", "content!" => "1" }]] }
```

---

## gsub

Replace parts of a text string.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `"find"` — The string to look for.
- `"replace"` — Replace each instance of the found string with this.

> For advanced use cases, you can use a regex expression for the "find" parameter.

**Examples:**

```ruby
#{_('sample.workato.action.status')}.gsub(/pattern/,"value")
"Jean Marie".gsub(/J/, "M") #"Mean Marie"
"Jean Marie".gsub("j", "M") #"Jean Marie"
"jean marie".gsub("j", "M") #"Mean marie"
"Awesome".gsub(/[Ae]/, 'A'=>'E', 'e'=>'a') #"Ewasoma"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#gsub)

_Tags: substitute, replace, switch_

---

## hmac_md5

Creates HMAC_MD5 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — secret key

**Examples:**

```ruby
"username:password:nonce".hmac_md5("key")
```

---

## hmac_sha1

Creates HMAC_SHA1 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — secret key

**Examples:**

```ruby
"username:password:nonce".hmac_sha1("key")
```

---

## hmac_sha256

Creates HMAC_SHA256 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — secret key

**Examples:**

```ruby
"username:password:nonce".hmac_sha256("key")
```

---

## hmac_sha512

Creates HMAC_SHA512 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — secret key

**Examples:**

```ruby
"username:password:nonce".hmac_sha512("key")
```

---

## hours

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.hours.from_now
3.hours.ago
```

---

## in_time_zone

Convert the time to a different timezone.

**Category:** date · **Operand types:** date_time

**Params:**

- `"tz"` — The timezone you want to convert to. <a target="_blank" href="https://docs.workato.com/formulas/date-formulas.html#in-time-zone">See list</a>

> Make sure the input is in the right format by using 'to_time' before this formula.
> If the input only has a date, the time is assumed as 00:00.000
> Timestamps with no specified timezones will use the timezone defined by the data center your Workato account is hosted in.

**Examples:**

```ruby
"2020-09-06T18:30:15.671720-05:00".to_time.in_time_zone("America/Los_Angeles") #"2020-09-06T16:30:15.671720-07:00"
"2020-05-31T12:30:45.303136-07:00".in_time_zone("America/New_York") #"2020-05-31T15:30:45.303136-04:00"
"2020-01-30".in_time_zone("America/New_York") #"2020-01-30T00:00:00.000000-05:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#in-time-zone)

---

## include?

Check if the string contains a specific substring.

**Category:** conditional · **Operand types:** string, array · **Returns:** boolean

**Params:**

- `value` — Value to check if string includes

**Examples:**

```ruby
#{_('sample.workato.action.status')}.include?("value")
"Partner account".include?("Partner") #true
"Partner account".include?("partner") #false
"partner account".include?("partner") #true
```

[Docs](https://docs.workato.com/formulas/{{ string|array-list }}-formulas.html#include)

---

## index

Returns the index of the first item matching the given value.

**Category:** array, string · **Operand types:** array, string · **Returns:** integer

**Params:**

- `value` — value to locate in the array

**Examples:**

```ruby
[0, 1, 2, 3].index(2) # 2
[0, 1, 2, 3].index(8) # nil
```

---

## is_not_true?

Convert a value to boolean and returns true if value is false.

**Category:** conditional · **Operand types:** boolean, integer, string · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.approved')}.is_not_true? # true
"false".is_not_true? # true
0.is_not_true? # true
nil.is_not_true? # true
```

[Docs](https://docs.workato.com/formulas/{{ number|string }}-formulas.html#is-not-true)

---

## is_true?

Converts a value to boolean and returns true if value is truthy.

**Category:** conditional · **Operand types:** boolean, integer, string · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.completed')}.is_true? # true
"false".is_true? # false
1.is_true? # true
nil.is_true? # false
```

[Docs](https://docs.workato.com/formulas/{{ string|number }}-formulas.html#is-true)

---

## join

Combine list items into a single text string.

**Category:** array · **Operand types:** array · **Returns:** string

**Params:**

- `separator` — The string to add between items when they're joined.

> The "separator" can be longer than one character.
> If you don't define a "separator", the list items are stuck together.

**Examples:**

```ruby
[1, 2, 3].join("-") #"1-2-3"
["ab", "cd", "ef"].join #"abcdef"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#join)

_Tags: combine, stick, concat, concatenate_

---

## last

Get the last n items in a list.

**Category:** array · **Operand types:** array

**Params:**

- `n` — Number of items to return.

> If you don't specify "n", only the last item will be returned.

**Examples:**

```ruby
["Jean", "Marie"].last #"Marie"
["Ms", "Jean", "Marie"].last #"Marie"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#last)

_Tags: reverse, back_

---

## length

Get the size of a list or text string.

**Category:** string, array · **Operand types:** string, array · **Returns:** integer

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.length
"New event".length #9
[ 1, 2, 3, 4, 5 ].length #5
[{..}, {..}, {..}].length #3
[" ", nil, "", nil].length #4
[].length #0
```

[Docs](https://docs.workato.com/formulas/{{ string|array-list }}-formulas.html#length)

---

## ljust

Aligns string to left and pads with whitespace or pattern until string is specified length.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `size` — Size of the padding
- `pad_string` — Padding pattern

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.ljust(100)
#{_('sample.workato.action.firstName')}.ljust(100, "*")
"test".ljust(5) #"test "
" test".ljust(10, "*") #" test*****"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#ljust)

---

## lookup

Lookup a record from your lookup tables.

**Returns:** hash

**Params:**

- `lookup_base` — Case sensitive name or ID of the lookup table in your account or search lookup entries result.
- `lookup_by` — Case sensitive name and value of lookup key. Comma separate multiple key value pairs, if any.

**Examples:**

```ruby
lookup('States list', 'State code': 'AZ')['State name'] #"Arizona"
lookup('States list', 'State name': 'Arizona')['State code'] #"AZ"
lookup('2522', 'State code': 'AZ')['State name'] #"Arizona" #use lookup table ID
lookup('States list', 'State code': 'az')['State name'] #nil due to case sensitivity
lookup('States list', 'State name': 'arizona')['State code'] #nil due to case sensitivity
lookup('States list', 'State code': #{_('sample.workato.action.stateCode')})['State name'] #lookup by a field value
lookup('Countries list', 'Country code': #{_('sample.workato.action.countryCode')})['Country name'] #"United States"
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#lookup)

---

## lookup_table

Lookup a value in a static lookup table via a key. Case sensitive, data type sensitive.

**Examples:**

```ruby
{"key1" => "value1", "key2" => "value2", "key3" => "value3"}["key3"] #value3
{"High" => "urgent", "Low" => "normal"}[#{_('sample.workato.action.priority')}] #"normal" if key is "Low"
{"High" => "urgent", "Low" => "normal"}[#{_('sample.workato.action.priority')}] #nil if key is "low"
{1 => "1", 2 => "2", 3 => "3"}[#{_('sample.workato.action.integerValue')}] #"2" if key is 2
{1 => "1", 2 => "2", 3 => "3"}[#{_('sample.workato.action.numberValue')}] #nil if key is 2.0
```

[Docs](https://docs.workato.com/formulas/other-formulas.html#lookup-table)

---

## lstrip

Remove white space from the beginning of string.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.lstrip
"     Test     ".lstrip #"Test     "
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#lstrip)

---

## match?

Check if a value is part of the data.

**Category:** string · **Operand types:** string · **Returns:** boolean

**Params:**

- `pattern` — Pattern to check for in the string

**Examples:**

```ruby
#{_('sample.workato.action.status')}.match?(/pattern/)
"Jean Marie".match?(/Marie/) #true
"Jean Marie".match?(/marie/) #false
"jean marie".match?(/marie/) #true
"Jean Marie".match?(/ /) #true
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#match)

---

## max

Largest value in an array. When comparing strings, the string with the largest ASCII value is returned.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
#{_('sample.workato.action.list')}.pluck(:total).max
["book", "apple", "cart"].max #"cart"
["cat", "dog", "rat"].max #"rat"
[-5, 0, 1, 2, 3, 4, 5].max #5
[-1.5, 1.5, 2, 3, 3.5].max #3.5
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#max)

---

## md5_hexdigest

Creates message digest using the MD5 Message-Digest Algorithm.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.api_key')}.md5_hexdigest
"hello".md5_hexdigest #5d41402abc4b2a76b9719d911017c592
```

---

## member?

Returns a boolean value true if the given object lies within the given range, else it returns false

**Category:** conditional · **Operand types:** range · **Returns:** boolean

**Params:**

- `value` — Value to check if the range contains

**Examples:**

```ruby
(1..100).member?(78) #true
(1..55).member?(96) #false
```

---

## min

Get the smallest value in a list.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
#{_('sample.workato.action.list')}.pluck(:total).min
["book", "apple", "cart"].min #"apple"
["cat", "dog", "rat"].min #"cat"
[-5, 0, 1, 2, 3, 4, 5].min #-5
[-1.5, 1.5, 2, 3, 3.5].min #-1.5
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#min)

---

## minmax

Get the smallest and largest value in a list.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
["book", "apple", "cart"].minmax #["apple", "cart"]
["cat", "dog", "rat"].minmax #["cat", "rat"]
[-5, 0, 1, 2, 3, 4, 5].minmax #[-5, 5]
[-1.5, 1.5, 2, 3, 3.5].minmax #[-1.5, 3.5]
```

---

## minutes

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.minutes.from_now
3.minutes.ago
```

---

## months

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.months.from_now
3.months.ago
```

---

## now

Get the time and date at runtime.

**Category:** date · **Returns:** date_time

> This formula runs whenever the job runs. Each step using this function will return a timestamp at which that step runs.
> If you only want the date without the time, try using 'today' instead.
> The default timezone is the US Pacific Time Zone.

**Examples:**

```ruby
now + 2.days
now + 8.hours
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#now)

_Tags: time, job time, date, job date, date_

---

## null

Gives a null/nil value. Note: passing this into an input field will not update the field value as null. Use clear formula to update a field value to null.

[Docs](https://docs.workato.com/formulas/other-formulas.html#null)

---

## odd?

Returns true if integer is an odd number.

**Category:** conditional, number · **Operand types:** integer · **Returns:** boolean

**Examples:**

```ruby
#{_('sample.workato.action.index')}.odd? # true
#{_('sample.workato.action.percentage')}.to_i.odd? # true
```

---

## ordinalize

Turns a number into an ordinal string used to denote the position in an ordered sequence such as 1st, 2nd, 3rd, 4th.

**Category:** number · **Operand types:** integer · **Returns:** string

**Examples:**

```ruby
1.ordinalize # "1st"
2.ordinalize # "2nd"
3.ordinalize # "3rd"
1003.ordinalize # "1003rd"
-3.ordinalize # "-3rd"
```

---

## pack

Packs the contents of an array into a binary sequence according to the directives set in the parameters.

**Category:** array · **Operand types:** array · **Returns:** string

**Params:**

- `template` — Template that specifies the structure of the resulting binary sequence

**Examples:**

```ruby
["a", "b", "c"].pack('A3A3A3') #a  b  c
```

---

## parameterize

Replaces special characters in a string.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
"öüâ".parameterize #"oua"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#parameterize)

---

## pluck

Get specified columns in a list.

**Category:** array · **Operand types:** array

**Params:**

- `column_name` — Column to get

**Examples:**

```ruby
[{'name' => 'Jake'}, {'name' => 'Kate'}].pluck('name') #['Jake', 'Kate']
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#pluck)

---

## presence

Get the data if it exists, return 'nil' if it doesn't.

**Category:** conditional

**Examples:**

```ruby
#{_('sample.workato.action.Type')}.presence
nil.presence #nil
"".presence #nil
0.presence #0
45.0.presence #45.0
```

[Docs](https://docs.workato.com/formulas/{{ string|date|number|array-list }}-formulas.html#presence)

---

## present?

Check if data exists.

**Category:** conditional · **Returns:** boolean

> This function only returns true or false. To get the actual data if it is present, use '.presence'

**Examples:**

```ruby
#{_('sample.workato.action.Type')}.present?
nil.present? #false
"".present? #false
0.present? #true
45.0.present? #true
```

[Docs](https://docs.workato.com/formulas/{{ string|array-list|number|date }}-formulas.html#present)

_Tags: null, nil_

---

## quote

Quotes a string, escaping any ' (single quote) characters.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.company')}.quote #=> "Paula's Baked Goods" -> "Paula''s Baked Goods"
```

---

## reverse

Reverse the order of items in a list.

**Category:** string, array · **Operand types:** string, array

**Examples:**

```ruby
#{_('sample.workato.action.FiscalYear')}.reverse
" Example String ".reverse #" gnirtS elpmaxE "
```

[Docs](https://docs.workato.com/formulas/{{ string|array-list }}-formulas.html#reverse)

---

## rjust

Aligns string to right and pads with whitespace or pattern until string is specified length.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `size` — Size of the padding
- `pad_string` — Padding pattern

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.rjust(100)
#{_('sample.workato.action.firstName')}.rjust(100, "*")
"test".rjust(5) #" test"
" test".rjust(10, "*!") #"*!*!* test"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#rjust)

---

## round

Round a value to a whole number.

**Category:** number · **Operand types:** number, float · **Returns:** number

**Examples:**

```ruby
#{_('sample.workato.action.price')}.round
11.99.round #12
11.555.round(2) #11.56
11.49.round(1) #11.5
```

[Docs](https://docs.workato.com/formulas/number-formulas.html#round)

---

## rsa_sha256

Creates RSA SHA256 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — private RSA key

**Examples:**

```ruby
"username:password:nonce".rsa_sha256("PEM key")
```

---

## rsa_sha512

Creates RSA SHA512 signature.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Params:**

- `key` — private RSA key

**Examples:**

```ruby
"username:password:nonce".rsa_sha512("PEM key")
```

---

## rstrip

Remove white space from the end of string.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.firstName')}.rstrip
" Test ".rstrip #" Test"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#rstrip)

---

## scan

Scan the string for the pattern to retrieve and return an array.

**Category:** string · **Operand types:** string

**Params:**

- `pattern` — Pattern to match

**Examples:**

```ruby
"Thu, 01/23/2020".scan(/\d+/).join("-") #01-23-2020
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#scan)

---

## scrub

Parses the string and returns a new one with any invalid bytes replaced.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `Replacement` — The character to replace any invalid bytes.

**Examples:**

```ruby
"abc\xE6".scrub("*") # => "abc*"
```

_Tags: replace, invalid_

---

## seconds

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.seconds.from_now
3.seconds.ago
```

---

## sha1

Creates message digest using SHA1 algorithm.

**Category:** string · **Operand types:** string, binary · **Returns:** binary

**Examples:**

```ruby
#{_('sample.workato.action.message')}.sha1
```

---

## skip

Deletes the key from the action or trigger input.

**Examples:**

```ruby
#{_('sample.workato.action.IsVendor')} ? "Vendor" : skip #"Vendor" if #{_('sample.workato.action.IsVendor')} is true, leaves the app untouched otherwise
```

---

## slice

Get part of a string.

**Category:** string · **Operand types:** string

**Params:**

- `start_index` — Index of the first character to return
- `length` — Length of the string to return, from start index onwards

> Use negative numbers to search from the end of the list.

**Examples:**

```ruby
"Jean Marie".slice(0,3) #"Jea"
"Jean Marie".slice(3,3) #"n M"
"Jean Marie".slice(-5,5) #"Marie"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#slice)

---

## slice_after

Splits a list into groups at the point after a match is made. Returns an enumerator. Best used with to_a

**Category:** array · **Operand types:** array

**Params:**

- `value` — Value to match in the list

> Use with to_a to compile the enumerator into a list

**Examples:**

```ruby
["book", "apple", "cart"].slice_after("book").to_a #[["book"], ["apple", "cart"]]
["cat", "dog", "rat"].slice_after("dog").to_a #[["cat", "dog"], ["rat"]]
[-5, 0, 1, 2, 3, 4, 5].slice_after(4).to_a #[[-5, 0, 1, 2, 3, 4], [5]]
[-1.5, 1.5, 2, 3, 3.5].slice_after(2).to_a #[[-1.5, 1.5, 2], [3, 3.5]]
```

---

## slice_before

Splits a list into groups at the point before a match is made. Returns an enumerator. Best used with to_a

**Category:** array · **Operand types:** array

**Params:**

- `value` — Value to match in the list

> Use with to_a to compile the enumerator into a list

**Examples:**

```ruby
["book", "apple", "cart"].slice_before("book").to_a #[["book", "apple", "cart"]]
["cat", "dog", "rat"].slice_before("dog").to_a #[["cat"], ["dog", "rat"]]
[-5, 0, 1, 2, 3, 4, 5].slice_before(4).to_a #[[-5, 0, 1, 2, 3], [4, 5]]
[-1.5, 1.5, 2, 3, 3.5].slice_before(2).to_a #[[-1.5, 1.5], [2, 3, 3.5]]
```

---

## smart_join

Combine list items into a single text string and remove white spaces.

**Category:** array · **Operand types:** array · **Returns:** string

**Params:**

- `separator` — Separator to add between each array element when joining into a string

**Examples:**

```ruby
[nil, " ", " Hello ", "   World "].smart_join(" ") #Hello World
[" Hello ", #{_('sample.workato.action.firstName')}].smart_join(" ")
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#smart-join)

---

## split

Cut a string into many parts.

**Category:** string · **Operand types:** string · **Returns:** array

**Params:**

- `char` — The character at which to split the text.

> The character used to split the string is removed from the output.
> If you don't specify “char”, it will be assumed as a white space(" ").
> "Char" can be a string of characters. ex: "You and Me".split(" and ") returns ["You", "Me"]

**Examples:**

```ruby
"Split string".split #["Split", "string"]
"Split string".split("t") #["Spli", " s", "ring"]
"01/23/2014".split("/").join("-") #01-23-2014
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#split)

_Tags: cut, list_

---

## starts_with?

Does field start with specified pattern? Returns true or false. Case-sensitive.

**Category:** string · **Operand types:** string · **Returns:** boolean

**Params:**

- `pattern` — Pattern to check string against

**Examples:**

```ruby
#{_('sample.workato.action.status')}.starts_with?("pattern")
"Jean Marie".starts_with?("Jean") #true
"Jean Marie".starts_with?("jean") #false
"JEAN MARIE".starts_with?("JEAN") #true
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#starts-with)

---

## strftime

Reformat how a date is displayed.

**Category:** date · **Operand types:** date, date_time · **Returns:** string

**Params:**

- `"format"` — The format to which you want the date/time converted.

> The input must be a "date" datatype. You can use the 'to_date' function before this to convert your data into a "date" type.

**Examples:**

```ruby
#{_('sample.workato.action.date')}.strftime("%Y/%m/%d") #"2020/01/30"
#{_('sample.workato.action.date')}.strftime("%Y-%m-%dT%H:%M:%S%z") #"2020-05-31T11:24:24-0700"
#{_('sample.workato.action.date')}.strftime("%B %e,%l:%M%p") #"August 7,  7:00AM"
#{_('sample.workato.action.date')}.strftime("%A, %d %B %Y %k:%M") #"Friday, 07 August 2020 7:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#strftime)

_Tags: text, stringify, readable, format_

---

## strip

Remove whitespaces from both sides of the text.

**Category:** string · **Operand types:** string · **Returns:** string

> This function removes white spaces from both sides of a string. To only remove them from one side, use 'lstrip' or 'rstrip'.
> To remove white spaces from the middle of the string, you'll need to use '.gsub(" ", "")'.
> If the string doesn't have any white spaces before or after, the input string will be returned as is.

**Examples:**

```ruby
#{_('sample.workato.action.status')}.strip
"   This is an example   ".strip #"This is an example"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#strip)

_Tags: empty, whitespace, strings, leading, trailing, start, end_

---

## strip_tags

Remove all HTML tags from a text string.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.status')}.strip_tags
"<html><body>Double bubble</body></html>".strip_tags #"Double bubble"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#strip-tags)

---

## sub

Substitute the first occurrence of a pattern with value.

**Category:** string · **Operand types:** string · **Returns:** string

**Params:**

- `pattern` — Pattern to search for
- `value` — Value to replace pattern with

**Examples:**

```ruby
#{_('sample.workato.action.status')}.sub(/pattern/,"value")
"Mean Marie".sub(/M/, "J") #"Jean Marie"
"Hello".sub(/[aeiou]/, "*") #"H*llo"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#sub)

---

## sum

Get the sum of all items in a list.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
#{_('sample.workato.action.list')}.pluck(:total).sum
[1, 2, 3].sum #6
[1.5, 2.5, 3].sum #7.0
["abc", "xyz"].sum #"abcxyz"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#sum)

---

## take

Return the first number of elements specified from the list

**Category:** array · **Operand types:** array

**Params:**

- `value` — Number of elements to return

**Examples:**

```ruby
["book", "apple", "cart"].take(1) #["book"]
["cat", "dog", "rat"].take(2) #["cat", "dog"]
[-5, 0, 1, 2, 3, 4, 5].take(4) #[-5, 0, 1, 2]
[-1.5, 1.5, 2, 3, 3.5].take(3) #[-1.5, 1.5, 2]
```

---

## titleize

Convert text to title case.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.Title')}.titleize
"double BUBBLE".titleize #"Double Bubble"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#titleize)

---

## to_country_alpha2

Convert alpha-3 country code or country name to alpha2 country code.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.country_code')}.to_country_alpha2
#{_('sample.workato.action.country')}.to_country_alpha2
"IND".to_country_alpha2 #"IN"
"India".to_country_alpha2 #"IN"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-country-alpha2)

---

## to_country_alpha3

Convert alpha-2 country code or country name to alpha3 country code.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.country_code')}.to_country_alpha3
#{_('sample.workato.action.country')}.to_country_alpha3
"AU".to_country_alpha3 #"AUS"
"Australia".to_country_alpha3 #"AUS"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-country-alpha3)

---

## to_country_name

Convert alpha-2/3 country code or country name to ISO3166 country name.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.country_code')}.to_country_name
#{_('sample.workato.action.country')}.to_country_name
"GB".to_country_name #"United Kingdom"
"GBR".to_country_name #"United Kingdom"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-country-name)

---

## to_csv

Generates CSV line from an array; handles escaping and nil values.
If the array is an array of arrays, converts each child array to a CSV line and returns the joined string.

**Category:** array · **Operand types:** array · **Returns:** string

**Examples:**

```ruby
[#{_('sample.workato.action.name')}, #{_('sample.workato.action.email')}, #{_('sample.workato.action.phone')}].to_csv #"John Smith,No-Email,555-1212\n"
[['John Smith', 'john@aol.com'], ['Kyle Doyle', 'kyle@yahoo.com']].to_csv #"John Smith,john@aol.com\nKyle Doyle,kyle@yahoo.com\n"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#to-csv)

---

## to_currency

Convert number or text to a currency format.

**Category:** string, number · **Operand types:** string, number, float, integer · **Returns:** string

**Examples:**

```ruby
1234567890.50.to_currency    # $1,234,567,890.50
1234567890.506.to_currency # $1,234,567,890.51
1234567890.506.to_currency(precision: 3)     # $1,234,567,890.506
1234567890.50.to_currency(unit: "€")      # €1,234,567,890.50
1234567890.50.to_currency(unit: "€", format: "%n %u")      # 1,234,567,890.50 €
-1234567890.50.to_currency(negative_format: "%u%n")      # $1,234,567,890.50
1234567890.50.to_currency(delimiter: ".",  separator: ",")      # $1.234.567.890,50
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-currency)

---

## to_currency_code

Convert alpha-2/3 country code or country name to ISO4217 currency code.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.country_name')}.to_currency_code # USD
#{_('sample.workato.action.country_code')}.to_currency_code # USD
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-currency-code)

---

## to_currency_name

Convert alpha-3 currency code or alpha-2/3 country code or country name to ISO4217 currency name.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.currency')}.to_currency_name # Dollars
#{_('sample.workato.action.country_name')}.to_currency_name # Dollars
#{_('sample.workato.action.country_code')}.to_currency_name # Dollars
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-currency-name)

---

## to_currency_symbol

Convert alpha-3 currency code or alpha-2/3 country code or country name to ISO4217 currency symbol.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.currency')}.to_currency_symbol # $
#{_('sample.workato.action.country_name')}.to_currency_symbol # $
#{_('sample.workato.action.country_code')}.to_currency_symbol # $
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-currency-symbol)

---

## to_date

Convert to a date datatype.

**Category:** conversion · **Operand types:** string, date_time · **Returns:** date

**Params:**

- `undefined` —

> The input data must resemble a date for this function to work.

**Examples:**

```ruby
#{_('sample.workato.action.details')}.to_date
"24/12/2014 10:30PM".to_date
"12/24/2014 10:30PM".to_date(format: "MM/DD/YYYY")
"2014/12/12 10:30PM".to_date(format: "YYYY/MM/DD")
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#to-date)

_Tags: format, datatype, type_

---

## to_f

Convert data to a float (number) datatype.

**Category:** conversion · **Returns:** float

> If the input doesn't have any numbers, the function returns 0.
> If the input is a whole number, the function adds a '.0' to the end.

**Examples:**

```ruby
#{_('sample.workato.action.Amount')}.to_f
45.67.to_f #45.67
"45.67".to_f #45.67
-45.67.to_f #-45.67
0.to_f #0.0
45.to_f #45.0
```

[Docs](https://docs.workato.com/formulas/{{ string|number }}-formulas.html#to-f)

_Tags: float, decimal, partial, fraction, datatype, type_

---

## to_hex

Converts binary string to its hex representation.

**Category:** conversion · **Operand types:** string, binary · **Returns:** string

**Examples:**

```ruby
"0J/RgNC40LLQtdGC
".decode_base64.to_hex
```

---

## to_i

Convert data to an integer (whole number) datatype.

**Category:** conversion · **Returns:** integer

> If the input doesn't have any numbers, the function returns 0.
> If the input has a decimal point, everything after the decimal will be omitted.

**Examples:**

```ruby
#{_('sample.workato.action.TotalOpportunityQuantity')}.to_i
45.67.to_i #45
-45.67.to_i #-45
0.to_i #0
```

[Docs](https://docs.workato.com/formulas/{{ string|number }}-formulas.html#to-i)

_Tags: integer, whole number, decimal, datatype, type_

---

## to_json

Convert an object or array to JSON.

**Category:** array · **Operand types:** hash, array · **Returns:** string

**Examples:**

```ruby
{"a" => "c d", "2" => "3"}.to_json #{"a":"c d","2":"3"}
["Array","1","2","3"].to_json #["Array","1","2","3"]
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#to-json)

---

## to_param

Returns a string representation for use as a URL query string.

**Category:** string, array · **Operand types:** string, array, hash · **Returns:** string

**Examples:**

```ruby
{name: 'Jake', age: '22'}.to_param #"name=Jake&age=22"
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#to-param)

---

## to_phone

Convert string or number to a formatted phone number.

**Category:** string, number · **Operand types:** string, integer · **Returns:** string

**Examples:**

```ruby
5551234.to_phone # 555-1234
"5551234".to_phone # 555-1234
1235551234.to_phone # 123-555-1234
1235551234.to_phone(area_code: true) # (123) 555-1234
1235551234.to_phone(delimiter: " ") # 123 555 1234
1235551234.to_phone(area_code: true, extension: 555) # (123) 555-1234 x 555
1235551234.to_phone(country_code: 1) # +1-123-555-1234
"123a456".to_phone # 123a456
```

[Docs](https://docs.workato.com/formulas/{{ string|number }}-formulas.html#to-phone)

---

## to_s

Convert to a string (text) datatype.

**Category:** conversion · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.CreatedDate')}.to_s #"2014-11-21 17:37:27 -0800"
#{_('sample.workato.action.CreatedDate')}.to_s(:short) #"18 Jan 06:10"
#{_('sample.workato.action.CreatedDate')}.to_s(:long) #"January 18, 2007 06:10"
```

[Docs](https://docs.workato.com/formulas/{{ string|number }}-formulas.html#to-s)

_Tags: string, datatype, type_

---

## to_state_code

Convert state name to code.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.state')}.to_state_code
#{_('sample.workato.action.state')}.to_state_code(#{_('sample.workato.action.country')})
"California".to_state_code #CA
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-state-code)

---

## to_state_name

Convert state code to name.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.state')}.to_state_name
#{_('sample.workato.action.state')}.to_state_name(#{_('sample.workato.action.country')})
"CA".to_state_name #CALIFORNIA
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#to-state-name)

---

## to_time

Convert data to an ISO time stamp.

**Category:** conversion · **Operand types:** string, date, date_time · **Returns:** date_time

> After conversion, the date will use the GMT timezone (+00:00).

**Examples:**

```ruby
"2020-04-02T12:30:30.462659-07:00".to_time #"2020-04-02T19:30:30.462659+00:00"
"2020-04-02".to_time #"2020-04-02T00:00:00.000000+00:00"
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#to-time)

---

## to_xml

Converts hash or array into XML string.

**Category:** array · **Operand types:** hash, array · **Returns:** string

**Examples:**

```ruby
{"name" => "Ken"}.to_xml(root: "user") #<user><name>Ken</name></user>
[{"name" => "Ken"}].to_xml(root: "users") #<users type="array"><user><name>Ken</name></user></users>
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#to-xml)

---

## today

Get the date at runtime.

**Category:** date · **Returns:** date

> This formula runs when the job runs. Each step using this function will return the date when that step runs.
> If you want the entire timestamp, try using 'now' instead.
> The default timezone is the US Pacific Time Zone.

**Examples:**

```ruby
today + 2.days # → 2020-01-25, Date 2 days after formula is executed.
today + 8.hours # → 2020-01-23 08:00:00 -0700, Timestamp 8 hours after formula is executed.
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#today)

_Tags: date, job date, time_

---

## transliterate

Replaces non-ASCII characters with an ASCII approximation, or if none exists, a replacement character which defaults to '?'.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
'Chloé'.transliterate #Chloe
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#transliterate)

---

## unicode_normalize

Returns a normalized form of the string, using Unicode normalizations NFC, NFD, NFKC, or NFKD. Default is :nfc.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
"a\u0300".unicode_normalize        #=> 'à' (same as "\u00E0")
"a\u0300".unicode_normalize(:nfc)  #=> 'à' (same as "\u00E0")
"\u00E0".unicode_normalize(:nfd)   #=> 'à' (same as "a\u0300")
```

---

## uniq

Return unique items in an array.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
#{_('sample.workato.action.list')}.pluck(:email).uniq
["array", "items", "array", "array", "items"].uniq #["array", "items"]
["joe", "jack", "jill", "joe", "jack"].uniq #["joe", "jack", "jill"]
[1, 2, 3, 1, 1, 3].uniq #[1, 2, 3]
[1.0, 1.5, 1.0].uniq #[1.0, 1.5]
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#uniq)

---

## unpack

Decodes str (which may contain binary data) according to the format string, returning an array of each value extracted.

**Category:** string · **Operand types:** string · **Returns:** array

**Examples:**

```ruby
"abc   abc   ".unpack("A6Z6") #["abc", "abc "]
```

---

## upcase

Convert text to upper case.

**Category:** string · **Operand types:** string · **Returns:** string

**Examples:**

```ruby
#{_('sample.workato.action.status')}.upcase
"Convert to UPCASE".upcase #"CONVERT TO UPCASE"
```

[Docs](https://docs.workato.com/formulas/string-formulas.html#upcase)

---

## utc

Convert time to UTC; for dates, first convert to a time.

**Category:** date · **Operand types:** date_time

**Examples:**

```ruby
#{_('sample.workato.action.created_at')}.utc # 2020-06-22 17:51:49 UTC
#{_('sample.workato.action.order_date')}.to_time.utc # 2020-06-22 07:00:00 UTC
```

---

## wday

Returns day of the week.

**Category:** date · **Operand types:** date, date_time · **Returns:** integer

> For strings, use 'to_date' to convert them to dates before using 'wday'.

**Examples:**

```ruby
"Tue, 12 Jan 2021".to_date.wday #2
"Fri, 15 Jan 2021".to_date.wday #5
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#wday)

---

## weeks

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.weeks.from_now
3.weeks.ago
```

---

## where

Get rows that match a condition.

**Category:** array · **Operand types:** array · **Returns:** array

**Params:**

- `undefined` —

> For advanced use cases, you can use a regex expression for the condition.

**Examples:**

```ruby
#{_('sample.workato.action.usersList')}.where(country: "USA", state: ["CA", "TX"])
#{_('sample.workato.action.usersList')}.where(rating: 10..50)
#{_('sample.workato.action.usersList')}.where.not(company: "IBM")
#{_('sample.workato.action.usersList')}.where("status !=": nil)
#{_('sample.workato.action.usersList')}.where("credit >=": 100)
#{_('sample.workato.action.leadsList')}.where("Address.country ==": "USA")
```

[Docs](https://docs.workato.com/formulas/array-list-formulas.html#where)

_Tags: filter_

---

## workato.aes_cbc_decrypt

Returns AES decrypted string using CBC mode

**Returns:** string

**Params:**

- `string` — string to decrypt
- `key` — secret key
- `initialization vector` — typically required to be random or pseudorandom (optional)

**Examples:**

```ruby
workato.aes_cbc_decrypt(encrypted_data, key)
workato.aes_cbc_decrypt(encrypted_data, workato.pbkdf2_hmac_sha1("password", salt), iv)
```

---

## workato.aes_cbc_encrypt

Returns AES encrypted string using CBC mode

**Returns:** string

**Params:**

- `data` — string to encrypt
- `key` — secret key
- `initialization vector` — typically required to be random or pseudorandom (optional)

**Examples:**

```ruby
workato.aes_cbc_encrypt(secret, key)
workato.aes_cbc_encrypt(secret, key, iv)
```

---

## workato.aes_gcm_decrypt

Returns AES decrypted string using GCM mode

**Returns:** string

**Params:**

- `string` — string to decrypt
- `key` — secret key
- `auth_tag` — cipher’s auth tag
- `initialization vector` — typically required to be random or pseudorandom
- `auth_data` — cipher’s additional authenticated data (optional)

**Examples:**

```ruby
workato.aes_gcm_decrypt(encrypted_data, key, auth_tag, iv)
workato.aes_gcm_decrypt(encrypted_data, workato.pbkdf2_hmac_sha1("password", salt), auth_tag, iv, auth_data)
```

---

## workato.aes_gcm_encrypt

Returns AES encrypted string and auth tag using GCM mode

**Returns:** array

**Params:**

- `data` — string to encrypt
- `key` — secret key
- `initialization vector` — typically required to be random or pseudorandom
- `auth_data` — cipher’s additional authenticated data (optional)

**Examples:**

```ruby
workato.aes_gcm_encrypt(secret, key, iv)
workato.aes_gcm_encrypt(secret, key, iv, auth_data)
```

---

## workato.jwt_decode

Decodes JWT using one of the algorithms from RS256, RS384, RS512, HS256, HS384, HS512, ES256, ES384, ES512

**Returns:** hash

**Params:**

- `jwt` — Token to decode (required)
- `key` — PEM or DER encoded RSA or EC private key or HMAC secret (required)
- `algorithm` — Use algorithm for JWT token. Supports RS256, RS384, RS512, HS256, HS384, HS512, ES256, ES384, ES512

**Examples:**

```ruby
workato.jwt_decode( "eyJhbGciO...", "PEM key", 'RS256') # => {"payload" => {"sub"=>"123", "name"=>"John", ...}, "header" => {"typ"=>"JWT", "alg"=>"RS256"}}
workato.jwt_decode( "eyJhbGciO...", "PEM key", 'RS512') # => {"payload" => {"sub"=>"123", "name"=>"John", ...}, "header" => {"typ"=>"JWT", "alg"=>"RS512"}}
workato.jwt_decode( "eyJhbGciO...", "my$ecretK3y", 'HS256') # => {"payload" => {"sub"=>"123", "name"=>"John", ...}, "header" => {"typ"=>"JWT", "alg"=>"HS256"}}
```

---

## workato.jwt_encode

Creates JWT using one of the algorithms from RS256, RS384, RS512, HS256, HS384, HS512, ES256, ES384, ES512

**Returns:** string

**Params:**

- `payload` — Payload to encode (required)
- `key` — PEM or DER encoded RSA or EC private key or HMAC secret (required)
- `algorithm` — Use algorithm for JWT token. Supports RS256, RS384, RS512, HS256, HS384, HS512, ES256, ES384, ES512
- `headers` — Header fields (optional)

**Examples:**

```ruby
workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS256', ) # => "eyJhbGciO..."
workato.jwt_encode({ name: "John Doe" }, "PEM key", 'RS512', kid: "24668") # => "eyJhbGciO..."
workato.jwt_encode({ name: "John Doe" }, "my$ecretK3y", 'HS256') # => "eyJhbGciO..."
```

---

## workato.parse_yaml

Parse a YAML string. Supports true, false, nil, numbers, strings, arrays, hashes

**Params:**

- `yaml` — A YAML string

**Examples:**

```ruby
workato.parse_yaml("---\nfoo: bar") # => { "foo" => "bar" }
workato.parse_yaml("---\n- 1\n- 2\n- 3\n") # => [1, 2, 3]
```

---

## workato.pbkdf2_hmac_sha1

Password-based Key derivation function, using a pseudo-random number generator based on HMAC SHA1

**Returns:** string

**Params:**

- `string` — string to encrypt
- `salt` — String with "salt"
- `iterations` — Number of iterations for HMAC algorithm (default: 1000)
- `key_len` — Length of the key (default: 16)

**Examples:**

```ruby
workato.pbkdf2_hmac_sha1("password", workato.random_bytes(8))
workato.pbkdf2_hmac_sha1("password", workato.random_bytes(8), 2000, 32)
```

---

## workato.random_bytes

Generates a String with length number of cryptographically strong pseudo-random bytes

**Returns:** string

**Params:**

- `length` — Number of bytes. Should be less or equal to 32

**Examples:**

```ruby
workato.random_bytes(4) # => "f\xF8\x8B"
```

---

## workato.render_yaml

Render an object into a YAML string.

**Returns:** string

**Params:**

- `obj` — an object to be rendered as YAML

**Examples:**

```ruby
workato.render_yaml({ "foo" => "bar" }) # => "---\nfoo: bar\n"
workato.render_yaml([1,2,3]) # => "---\n- 1\n- 2\n- 3\n"
```

---

## workato.uuid

Generates UUID.

**Returns:** string

**Examples:**

```ruby
workato.uuid #c52d735a-aee4-4d44-ba1e-bcfa3734f553
```

---

## workato.verify_rsa

Verifies RSA signature

**Returns:** boolean

**Params:**

- `payload` — Signed data
- `certificate` — PEM or DER encoded X.509 Certificate with a RCA public key
- `signature` — Signature
- `algorithm` — Signing algorithm. Supports SHA, SHA1, SHA224, SHA256, SHA384, SHA512

**Examples:**

```ruby
workato.verify_rsa({ name: "John Doe" }.to_json, "PEM Certificate", "\0x86...\0x32", "SHA256") # => true
```

---

## yday

Returns day of the year.

**Category:** date · **Operand types:** date, date_time · **Returns:** integer

> For strings, use 'to_date' to convert them to dates before using 'yday'.

**Examples:**

```ruby
"2020-01-01".to_date.yday #1
"2020-02-01".to_date.yday #32
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#yday)

---

## years

Defines a time unit for the time traversal methods like .ago and .from_now.

**Category:** date · **Operand types:** integer · **Returns:** unit_of_time

**Examples:**

```ruby
2.years.from_now
3.years.ago
```

---

## yweek

Returns week of the year.

**Category:** date · **Operand types:** date, date_time · **Returns:** integer

> For strings, use 'to_date' to convert them to dates before using 'yweek'.

**Examples:**

```ruby
"2020-01-01".to_date.yweek #1
"2020-02-01".to_date.yweek #5
```

[Docs](https://docs.workato.com/formulas/date-formulas.html#yweek)

---

## zip

Converts any arguments to arrays, then merges elements of self with corresponding elements from each argument.

**Category:** array · **Operand types:** array

**Examples:**

```ruby
[1, 2, 3].zip([4, 5, 6, 7]) # [[1, 4], [2, 5], [3, 6]]
[1, 2].zip([3, 4], [5, 6]) # [[1, 3, 5], [2, 4, 6]]
[1, 2].zip([3, 4, 5]) # [[1, 3], [2, 4]]
[1, 2, 3].zip([4, 5]) # [[1, 4], [2, 5], [3, nil]]
```

[Docs](https://docs.workato.com/developing-connectors/sdk/sdk-reference/ruby_methods.html#zip)

---
