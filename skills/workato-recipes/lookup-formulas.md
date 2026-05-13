# Lookup formulas

Formulas that query external data sources from inside a recipe — distinct from the per-datapill transformations in the other files. All three are **case-sensitive AND datatype-sensitive** on both the column name and the lookup value, and return `nil` on miss (no exception).

## `data_table_lookup` — query a Workato Data Table

Newer Data Tables feature (UUID-keyed columns, relational schema). Project-scoped.

### Signature

```
data_table_lookup('Project name', 'Table name', 'Match column': 'Match value')['Return column']
```

| Arg                 | Notes                                                          |
| ------------------- | -------------------------------------------------------------- |
| `'Project name'`    | Project containing the data table. Exact name, case-sensitive. |
| `'Table name'`      | Data table name within the project. Exact, case-sensitive.     |
| `'Match column'`    | Key column name. Exact, case-sensitive.                        |
| `'Match value'`     | Value to find. Case-sensitive AND type-sensitive.              |
| `['Return column']` | Column whose value is returned. Exact, case-sensitive.         |

### Examples

- `data_table_lookup('Wedding', 'Wedding Guests', 'Transport': 'Yes')['Seat No.']` → `"10"`
- `data_table_lookup('Wedding', 'Wedding Guests', 'First Name': 'Angela')['Table No.']` → `1`
- `data_table_lookup('Wedding', 'Wedding Guests', 'First Name': 'angela')['Table No.']` → `nil` _(case mismatch on value)_
- `data_table_lookup('Wedding', 'Wedding Guests', 'first name': 'Angela')['Table No.']` → `nil` _(case mismatch on column)_
- `data_table_lookup('Wedding', 'Wedding Guests', 'First Name': 'Angela')['Table no.']` → `nil` _(case mismatch on return column)_

### Gotchas

- **Integer-typed datapill → string-typed column**: cast first with `.to_s`. The lookup compares both type and value.
  - `data_table_lookup('Proj', 'Tbl', 'SKU': _dp("step.id").to_s)['Name']`
- **Whitespace counts.** `'Angela '` (trailing space) ≠ `'Angela'`. Use `.strip` on the lookup value if data may have padding.
- **First match wins.** If multiple rows match, you get the first. Use a row-list MCP tool (`workato_data_table_row_list`) for full-result needs.
- **Use [[workato_data_tables_list]] / [[workato_data_table_get]] MCP tools** to verify project/table/column names exactly before pasting them into the formula — typos return `nil` silently.

## `lookup` — query a Workato Lookup Table

Older Lookup Tables feature (positional `col1..col10` schema, but lookups use the **column header**, not `colN`). Workspace-scoped (no project arg).

### Signature

```
lookup('Lookup table name OR id', 'Match column': 'Match value')['Return column']
```

### Examples

- `lookup('Department Lookup table', 'Department Code': 'ACC')['Department']` → `"Accounting"`
- `lookup('Department Lookup table', 'Department Code': 'SLS')['Department']` → `"Sales"`
- `lookup('Department Lookup table', 'Department': 'Marketing')['Department Code']` → `"MKT"`
- `lookup('Department Lookup table', 'Department': 'marketing')['Department Code']` → `nil` _(case-sensitive)_
- `lookup('Department Lookup table', 'Department': 'Marketing')['Department code']` → `nil` _(return column case-sensitive)_
- `lookup('6', 'Department code': 'ACC')['Department']` → `"Accounting"` _(numeric table ID as a string)_

### Gotchas

- **Table identifier may be the table name OR its numeric ID as a string** (`'6'`, not `6`). Names with rename history may break — IDs are stable.
- **Lookup-table column headers are user-defined labels**, not the underlying `col1..col10` positional names. Use the header.
- **Use [[workato_lookup_tables_list]] / [[workato_lookup_table_get]] MCP tools** to confirm the exact header strings before authoring the formula.

## `lookup_table` — inline static map

A hash literal used as a quick switch/lookup. No external data — the values are embedded directly in the formula.

### Examples

- `{"High" => "urgent", "Medium" => "mid", "Low" => "normal"}["Low"]` → `"normal"`
- `{"High" => "urgent", "Medium" => "mid", "Low" => "normal"}["low"]` → `nil` _(case-sensitive)_
- `{1 => "1", 2 => "2", 3 => "3"}[2]` → `"2"`
- `{1 => "1", 2 => "2", 3 => "3"}[2.0]` → `nil` _(`2` and `2.0` are different types)_

### When to use which

| You need                                             | Use                                     |
| ---------------------------------------------------- | --------------------------------------- |
| 3–20 hard-coded mappings, never change               | `lookup_table` (inline hash)            |
| Mappings edited by ops in a UI, no schema            | `lookup` (older Lookup Tables)          |
| Multi-column relational data, types, project scoping | `data_table_lookup` (newer Data Tables) |

## Pattern: default when lookup misses

All three return `nil` on miss. Combine with `.presence || default` or a ternary:

```ruby
lookup('Department Lookup table', 'Department Code': _dp("step.code"))['Department'].presence || 'Unknown'

data_table_lookup('Wedding', 'Wedding Guests', 'First Name': _dp("step.name"))['Seat No.'] || 'TBD'
```
