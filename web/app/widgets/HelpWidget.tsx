"use client";

const COMMANDS: [string, string][] = [
  ["chart <SYMBOL>", "Price chart — equity or crypto pair (e.g. AAPL, BTC/USD)"],
  ["quote <SYMBOL>", "Snapshot quote — equity or crypto (e.g. AAPL, BTC)"],
  ["watch <SYMBOL>", "Add a symbol to the watchlist"],
  ["unwatch <SYMBOL>", "Remove a symbol from the watchlist"],
  ["port", "Portfolio: positions (IBKR) + balances (Kraken)"],
  ["yield", "US Treasury yield curve (FRED)"],
  ["news [feed]", "Headlines (optional feed name)"],
  ["follow <name>", "Follow a person; opens their feed (news, interviews, talks)"],
  ["unfollow <name>", "Stop following a person"],
  ["following", "Manage who you follow + see the aggregated feed"],
  ["cal", "Economic calendar (not implemented yet)"],
  ["settings", "App settings — color theme, text size, connection status"],
  ["help", "This command list"],
];

export default function HelpWidget() {
  return (
    <div style={{ padding: "1rem 1.25rem" }}>
      <strong style={{ fontSize: "1.05rem" }}>Commands</strong>
      <p style={{ color: "var(--muted)", margin: "0.4rem 0 1rem" }}>
        Type a command in the bar below (⌘/Ctrl-K focuses it; ↑/↓ recalls history).
      </p>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {COMMANDS.map(([cmd, desc]) => (
            <tr key={cmd} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "0.4rem 1.2rem 0.4rem 0", color: "var(--accent)", whiteSpace: "nowrap" }}>
                <code>{cmd}</code>
              </td>
              <td style={{ padding: "0.4rem 0", color: "var(--foreground)" }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
