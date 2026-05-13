# Date formulas

Methods for date / datetime datapills.

## Pseudo-globals

### `now` / `today`

- `now` → current datetime in **US/Pacific**, e.g. `"2022-02-01T07:00:00.000000-08:00"`
- `today` → current date in **US/Pacific**, e.g. `"2022-02-01"`

**Gotcha**: default zone is Pacific, **not** UTC. Use `.in_time_zone(nil)` to get UTC.

## Date math

### `+ N.unit` / `- N.unit`

Units: `seconds`, `minutes`, `hours`, `days`, `weeks`, `months`, `years`. Chainable.

- `"2020-01-01".to_date + 2.days` → `"2020-01-03"`
- `"2020-01-01".to_date - 2.months` → `"2019-11-01"`
- `now + 8.hours + 2.days` → chained offset

### `N.unit.from_now` / `N.unit.ago`

Sugar for `now + N.unit` / `now - N.unit`.

- `30.seconds.from_now` → `"2022-02-01T07:00:30.000000-08:00"`
- `2.months.ago` → `"2020-10-04 14:45:29 -0700"`

## Day / week / year extraction

### `.wday`

Day-of-week (0=Sun..6=Sat). `today.wday` → `4` for Thursday.

### `.yday`

Day-of-year (1-366). `"2020-01-01".to_date.yday` → `1`.

### `.yweek`

Week-of-year (1-53). `"2020-01-01".to_date.yweek` → `1`.

## Period boundaries

### `.beginning_of_hour` / `.beginning_of_day` / `.beginning_of_week` / `.beginning_of_month` / `.beginning_of_year`

Returns datetime at the start of that unit. Week starts Monday.

- `today.to_time.beginning_of_hour` → `"2020-12-02T16:00:00.000000-07:00"`
- `today.beginning_of_day` → `"2020-12-02T00:00:00.000000-07:00"`
- `today.beginning_of_week` → Monday `00:00:00`
- `today.beginning_of_month` → `"2020-12-01T00:00:00..."`
- `today.beginning_of_year` → `"2020-01-01T00:00:00..."`

### `.end_of_month`

Last day of the month; preserves input type (date in → date out, datetime in → `23:59:59.999999`).

- `today.end_of_month` → `"2020-12-31"`

## Formatting

### `.strftime(format)`

Format date/datetime per pattern. Codes:

| Code | Meaning                     |
| ---- | --------------------------- |
| `%Y` | 4-digit year                |
| `%m` | 2-digit month (01-12)       |
| `%d` | 2-digit day (01-31)         |
| `%H` | 24-hour (00-23)             |
| `%I` | 12-hour (01-12)             |
| `%M` | minute (00-59)              |
| `%S` | second (00-59)              |
| `%p` | AM/PM                       |
| `%B` | month name                  |
| `%e` | day-of-month (space-padded) |
| `%z` | UTC offset                  |

Examples:

- `"2020-06-05T17:13:27.000000-07:00".to_date.strftime("%Y/%m/%d")` → `"2020/06/05"`
- `"2020-06-05T17:13:27.000000-07:00".strftime("%B %e, %l:%M%p")` → `"June  5,  5:13 pm"`

## Timezones

### `.in_time_zone(zone=nil)`

Convert to a named timezone (IANA). No arg → Pacific; `nil` → UTC.

- `now.in_time_zone("America/New_York")`
- `"2020-06-01T01:30:45.000000-07:00".in_time_zone(nil)` → `"2020-06-01T08:30:45.000000+00:00"`

**Gotcha**: bare `.in_time_zone` defaults to **Pacific**, not UTC. Pass `nil` for UTC.

### `.dst?`

True if the datetime falls inside daylight savings.

- `today.in_time_zone("America/New_York").dst?` → `true` in summer

## Parsing

### `.to_date(format: "...")`

Parses a string to a date. Output is always `YYYY-MM-DD` regardless of input format.

- `"23-01-2020 10:30 pm".to_date(format: "DD-MM-YYYY")` → `"2020-01-23"`
- `"2020/01/23".to_date(format: "YYYY/MM/DD")` → `"2020-01-23"`

**Gotcha**: `format:` describes the **input**, not the output.

### `.to_time(format: "...")`

Parses to ISO datetime in UTC. Missing time defaults to `00:00:00`.

- `"2020-04-02".to_time` → `"2020-04-02T00:00:00.000+00:00"`
- `"2020-04-02T12:30:30.462659-07:00".to_time(format: "%Y-%m-%dT%H:%M:%S")` → `"2020-04-02T19:30:30.000+00:00"`

## Epoch conversion

### `.to_i` (on datetime)

Unix epoch seconds (UTC).

- `now.to_i` → e.g. `1645714000`

**Gotcha**: returns **seconds**, not milliseconds; call `.to_time` first if input is a date.

### Epoch → datetime

There is no built-in `Time.at`; reconstruct from Unix epoch via:

- `"1970-01-01".to_time + 1645660800.seconds` → UTC datetime
- `"1970-01-01".to_time.in_time_zone("America/New_York") + 1645660800.seconds` → zoned datetime
