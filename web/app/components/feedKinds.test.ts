import { describe, expect, it } from "vitest";
import { KIND_LABEL, presentKinds } from "./FeedItemList";
import type { FollowItem } from "../lib/api/client";

const mk = (kind: string): FollowItem =>
  ({ person: "P", title: "t", summary: "", url: `u-${kind}`, publishedTs: 1,
     source: "s", kind, publisher: null, primary: true, relevant: true } as FollowItem);

describe("presentKinds", () => {
  it("returns distinct kinds in first-appearance order", () => {
    expect(presentKinds([mk("video"), mk("news"), mk("video")])).toEqual(["video", "news"]);
  });
  it("is empty for no items", () => {
    expect(presentKinds([])).toEqual([]);
  });
});

describe("KIND_LABEL", () => {
  it("maps the canonical blog kind to the Writing label", () => {
    expect(KIND_LABEL.blog).toBe("Writing");
    expect(KIND_LABEL.speech).toBe("Speech");
  });
});
