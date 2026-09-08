# Workato Account and Project Properties Web Endpoints Specification

Date: 2026-09-08
Author: Roman Chikalenko
Version: 1.0.0
Status: Verified against live Workato instance (workspace "Power Factors", environment "Development").

## Summary of Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/account_properties.json` | List all account (environment) properties |
| POST | `/account_properties.json` | Create an account property |
| PUT | `/account_properties/:id.json` | Update an account property (optimistic locking) |
| DELETE | `/account_properties/:id.json` | Delete an account property |
| GET | `/account_properties.json?project_id=:project_id` | List project properties for a specific project |
| POST | `/account_properties.json?project_id=:project_id` | Create a project property in a project |
| PUT | `/account_properties/:id.json?project_id=:project_id` | Update a project property (optimistic locking) |
| DELETE | `/account_properties/:id.json?project_id=:project_id` | Delete a project property |

## Architecture Overview

Workato uses a single REST controller (`/account_properties.json`) for both workspace-level (environment) properties and project-level properties.

1. Scope determination:
   - Account properties omit the `project_id` query parameter.
   - Project properties append `?project_id=<id>` to the request path.
   - The ID in `project_id` must be the project ID (e.g. `15842038`). It is not the folder ID (`fid`).

2. Versioning and ID behavior:
   - Workato properties use an append-only row versioning model.
   - Updating a property via `PUT` issues a new record version: the numeric `id` changes and `version_no` advances.
   - Updates require the caller to supply `last_version_no` matching the current `version_no`. If omitted or mismatched, the server rejects the write.

3. Scoping and Environment isolation:
   - In multi-environment workspaces (Development, Test, Production), each environment is an isolated workspace tenant with its own environment ID.
   - Account properties are scoped to the active environment.
   - Recipes deployed across environments reference properties by name and resolve the environment-specific value at job start.
   - Project properties are scoped to a single project. Recipes inside that project can access them.
   - Project properties do not override or shadow account properties. Both appear as separate entries in the recipe data tree under `Properties`.

4. Sensitive and masked properties:
   - If a property name contains `password`, `key`, or `secret` (case-insensitive), Workato sets `"sensitive": true`.
   - The JSON API returns the plain text value in all responses even when `sensitive` is true.
   - Value masking (e.g. `XXXXXXXXXX123`) is enforced only in the browser UI, not by the JSON API.

5. Common Request Headers:
   - Session cookies: required on all requests.
   - `Accept`: `application/json, text/plain, */*`
   - `X-Requested-With`: `XMLHttpRequest` (required on all routes)
   - `Content-Type`: `application/json` (required on POST and PUT)
   - `X-CSRF-TOKEN`: required on state-changing requests (POST, PUT, DELETE), read from the `XSRF-TOKEN-V2` cookie.

6. Common Error Format:
   - The API returns HTTP 200 with an error object rather than HTTP 4xx for validation failures.
   - Format: `{"error": {"details": {"<field>": ["<message>"]}}}`.

---

## 1. List Account Properties

**Method:** `GET`
**Path:** `/account_properties.json`
**Auth:** Session cookie. No CSRF token required.
**Headers:** `Accept: application/json`, `X-Requested-With: XMLHttpRequest`.

### Query Parameters

The server returns the complete list of properties in one response. Pagination parameters (`page`, `per_page`, `offset`) and filter parameters (`search`, `q`, `text`) are ignored by the backend. The Workato web UI handles search filtering and column sorting client-side.

### Response

**Status:** `200 OK`

```json
{
  "result": [
    {
      "id": 19189098,
      "name": "Workato SFDC User ID",
      "value": "005RT00000duS1ZYAU",
      "version_no": "1785338089.43985",
      "sensitive": false
    },
    {
      "id": 19865009,
      "name": "mcp_probe_secret_key",
      "value": "sensitive_test_value_123",
      "version_no": "1788860308.41596",
      "sensitive": true
    }
  ]
}
```

---

## 2. Create Account Property

**Method:** `POST`
**Path:** `/account_properties.json`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Request Body

```json
{
  "account_property": {
    "name": "mcp_probe_alpha",
    "value": "probe_value_alpha"
  }
}
```

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19864989,
    "name": "mcp_probe_alpha",
    "value": "probe_value_alpha",
    "version_no": "1788860207.51103",
    "sensitive": false
  }
}
```

### Response (Error: Duplicate Name)

**Status:** `200 OK`

```json
{
  "error": {
    "details": {
      "name": [
        "has already been taken"
      ]
    }
  }
}
```

### Response (Error: Missing Name)

**Status:** `200 OK`

```json
{
  "error": {
    "details": {
      "name": [
        "can't be blank"
      ]
    }
  }
}
```

Note: An empty value string (`""`) is allowed by the server. It creates a property with an empty string value.

---

## 3. Update Account Property

**Method:** `PUT`
**Path:** `/account_properties/:id.json`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Concurrency Rules

Workato enforces optimistic concurrency. The caller must pass `last_version_no` containing the current `version_no` of the record. Both value updates and property renames are supported.

When an update succeeds, Workato creates a new version row. The response contains a new `id` and updated `version_no`. Subsequent calls must use the new `id` and new `version_no`.

### Request Body

```json
{
  "account_property": {
    "id": 19864989,
    "name": "mcp_probe_beta",
    "value": "probe_value_alpha_updated",
    "version_no": "1788860207.51103",
    "sensitive": false,
    "last_version_no": "1788860207.51103"
  }
}
```

Minimal payload accepted by server:

```json
{
  "account_property": {
    "last_version_no": "1788860207.51103",
    "name": "mcp_probe_beta",
    "value": "probe_value_alpha_updated"
  }
}
```

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19864997,
    "name": "mcp_probe_beta",
    "value": "probe_value_alpha_updated",
    "version_no": "1788860285.09003",
    "sensitive": false
  }
}
```

### Response (Error: Stale Concurrency Lock)

Occurs if `last_version_no` is omitted, outdated, or mismatched.

**Status:** `200 OK`

```json
{
  "error": {
    "details": {
      "base": [
        "can't update a stale row"
      ]
    }
  }
}
```

---

## 4. Delete Account Property

**Method:** `DELETE`
**Path:** `/account_properties/:id.json`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Request Body

None.

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19864990,
    "name": "mcp_probe_empty_val",
    "value": "",
    "version_no": "1788860220.73489",
    "sensitive": false
  }
}
```

---

## 5. List Project Properties

**Method:** `GET`
**Path:** `/account_properties.json?project_id=:project_id`
**Auth:** Session cookie. No CSRF token required.
**Headers:** `Accept: application/json`, `X-Requested-With: XMLHttpRequest`.

### Query Parameters

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `project_id` | number / string | Yes | The numeric ID of the project (e.g. `15842038`). |

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": [
    {
      "id": 19865018,
      "name": "mcp_probe_proj_alpha",
      "value": "probe_proj_value_1",
      "version_no": "1788860403.01203",
      "sensitive": false
    }
  ]
}
```

When no project properties exist in the project, the response is:

```json
{
  "result": []
}
```

---

## 6. Create Project Property

**Method:** `POST`
**Path:** `/account_properties.json?project_id=:project_id`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Request Body

```json
{
  "account_property": {
    "name": "mcp_probe_proj_alpha",
    "value": "probe_proj_value_1"
  }
}
```

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19865018,
    "name": "mcp_probe_proj_alpha",
    "value": "probe_proj_value_1",
    "version_no": "1788860403.01203",
    "sensitive": false
  }
}
```

### Response (Error: Duplicate Within Same Project)

**Status:** `200 OK`

```json
{
  "error": {
    "details": {
      "name": [
        "has already been taken"
      ]
    }
  }
}
```

### Name Sharing Between Project and Account Properties

A project property CAN share the exact same name as an account property without collision. The server permits this and creates the project property successfully.

---

## 7. Update Project Property

**Method:** `PUT`
**Path:** `/account_properties/:id.json?project_id=:project_id`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Request Body

```json
{
  "account_property": {
    "id": 19865018,
    "name": "mcp_probe_proj_alpha",
    "value": "probe_proj_value_1_updated",
    "version_no": "1788860403.01203",
    "sensitive": false,
    "last_version_no": "1788860403.01203"
  }
}
```

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19865021,
    "name": "mcp_probe_proj_alpha",
    "value": "probe_proj_value_1_updated",
    "version_no": "1788860429.25835",
    "sensitive": false
  }
}
```

---

## 8. Delete Project Property

**Method:** `DELETE`
**Path:** `/account_properties/:id.json?project_id=:project_id`
**Auth:** Session cookie, `X-CSRF-TOKEN`.
**Headers:** `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`.

### Request Body

None.

### Response (Success)

**Status:** `200 OK`

```json
{
  "result": {
    "id": 19865021,
    "name": "mcp_probe_proj_alpha",
    "value": "probe_proj_value_1_updated",
    "version_no": "1788860429.25835",
    "sensitive": false
  }
}
```

---

## Reference in Recipes and Datapills

Properties are exposed to recipes as datapills in the recipe data tree. They are not exposed as built-in formula functions (there is no `account_property('key')` or `project_property('key')` formula call).

1. Data tree navigation:
   - Account properties: `Recipe data > Properties > Environment properties`
   - Project properties: `Recipe data > Properties > Project properties`

2. Formula mode usage:
   - When dropped into formula mode, properties appear as datapill tokens.
   - For fallback resolution between a project property and an account property, recipes use Ruby formula expressions:
     ```ruby
     project_property.presence || account_property
     ```
     or
     ```ruby
     project_property.blank? ? account_property : project_property
     ```

3. Execution behavior:
   - Property values are frozen at job initialization. Changes made to a property during a running job do not affect active jobs.

---

## Platform Limits and Constraints

| Metric | Limit | Source |
| --- | --- | --- |
| Max environment properties per environment | 1,000 | Documentation / `auth_user.json` (`accountPropertiesLimit: 1000`) |
| Max project properties per project | 1,000 | Documentation |
| Max length of property name | 100 characters | Documentation |
| Max length of property value | 1,024 characters | Documentation |
| Allowed characters in property name | Alphanumeric, spaces, underscores, symbols | Verified |

---

## Unverified

1. Exact behavior of bulk property creation or import via CSV: the UI provides no bulk import button for account properties, unlike lookup tables.
2. Property export behavior during recipe lifecycle management (package deployment): whether environment property definitions are bundled into export manifest ZIP packages or must be provisioned ahead of deployment.
3. Behavior when 1,001st property is created: whether the server returns HTTP 200 with an error object or HTTP 422.
