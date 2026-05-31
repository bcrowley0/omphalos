import { describe, expect, it } from "vitest";
import { coercePrefs } from "./widgetPrefs";

describe("coercePrefs", () => {
  const defaults = { a: 1 };
  const coerce = (x: unknown) => ({
    a: typeof (x as { a?: unknown })?.a === "number" ? (x as { a: number }).a : 1,
  });

  it("returns defaults for null (no stored value)", () => {
    expect(coercePrefs(null, defaults, coerce)).toEqual({ a: 1 });
  });

  it("returns defaults for invalid JSON", () => {
    expect(coercePrefs("{not json", defaults, coerce)).toEqual({ a: 1 });
  });

  it("runs coerce on valid JSON", () => {
    expect(coercePrefs('{"a":5}', defaults, coerce)).toEqual({ a: 5 });
  });

  it("coerce fills defaults for missing fields", () => {
    expect(coercePrefs('{"b":9}', defaults, coerce)).toEqual({ a: 1 });
  });
});
