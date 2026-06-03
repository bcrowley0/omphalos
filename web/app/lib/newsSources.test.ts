// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadEnabledSources,
  saveEnabledSources,
  withSource,
  withoutSource,
} from "./newsSources";

beforeEach(() => window.localStorage.clear());

describe("newsSources enabled-set store", () => {
  it("defaults to an empty list when nothing is stored", () => {
    expect(loadEnabledSources()).toEqual([]);
  });

  it("round-trips saved names, normalized to uppercase and deduped", () => {
    saveEnabledSources(["coindesk", "FED", "coindesk"]);
    expect(loadEnabledSources().sort()).toEqual(["COINDESK", "FED"]);
  });

  it("rejects bogus persisted values and falls back to empty", () => {
    window.localStorage.setItem("omphalos.news.enabledSources.v1", JSON.stringify({ not: "an array" }));
    expect(loadEnabledSources()).toEqual([]);
  });

  it("withSource adds (uppercased, no dupes) immutably", () => {
    const a = ["FED"];
    const b = withSource(a, "coindesk");
    expect(b).toEqual(["FED", "COINDESK"]);
    expect(withSource(b, "fed")).toEqual(["FED", "COINDESK"]); // already present
    expect(a).toEqual(["FED"]); // original unchanged
  });

  it("withoutSource removes case-insensitively, immutably", () => {
    const a = ["FED", "COINDESK"];
    expect(withoutSource(a, "coindesk")).toEqual(["FED"]);
    expect(a).toEqual(["FED", "COINDESK"]); // original unchanged
  });
});
