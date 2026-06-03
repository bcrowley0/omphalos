// UI-only categorization of a pasted source URL/handle (migration + validation).
// Mirrors the backend's classify_feed_url; this is not a response shape.
export type FeedKind = "youtube" | "podcast" | "writing";

export function classifyFeedUrl(url: string): FeedKind {
  const u = url.toLowerCase().trim();
  if (u.startsWith("@") || u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (
    u.includes("podcasts.apple.com") ||
    u.includes("megaphone") ||
    u.includes("libsyn") ||
    u.includes("/podcast") ||
    u.includes("feeds.simplecast")
  )
    return "podcast";
  return "writing";
}
