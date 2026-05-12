/**
 * @fileoverview JSON primitive type definitions for Record-Replay V3.
 */

/** JSON primitive types. */
export type JsonPrimitive = string | number | boolean | null;

/** JSON object type. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON array type. */
export type JsonArray = JsonValue[];

/** Any JSON value. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** ISO 8601 date-time string. */
export type ISODateTimeString = string;

/** Unix millisecond timestamp. */
export type UnixMillis = number;
