// Compact relative-time formatter shared by feed widgets.
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

// Absolute local timestamp: time-of-day for today, "Mon D, HH:MM" otherwise.
export function absTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
