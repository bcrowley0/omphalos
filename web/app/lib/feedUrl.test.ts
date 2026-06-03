import { describe, expect, it } from "vitest";
import { classifyFeedUrl } from "./feedUrl";

describe("classifyFeedUrl", () => {
  it("routes youtube handles and urls", () => {
    expect(classifyFeedUrl("@karpathy")).toBe("youtube");
    expect(classifyFeedUrl("https://www.youtube.com/@karpathy")).toBe("youtube");
    expect(classifyFeedUrl("https://youtu.be/abc")).toBe("youtube");
  });
  it("routes podcast feeds", () => {
    expect(classifyFeedUrl("https://feeds.megaphone.fm/show")).toBe("podcast");
    expect(classifyFeedUrl("https://podcasts.apple.com/us/podcast/x/id1")).toBe("podcast");
  });
  it("routes everything else to writing", () => {
    expect(classifyFeedUrl("https://karpathy.github.io/feed.xml")).toBe("writing");
  });
});
