import type { Command } from "./types";

// Pure command-bar parser. Plain-verb grammar from CLAUDE.md. No side effects,
// fully unit-tested. Unknown verbs and missing arguments produce an `error`
// command the UI renders inline (never throws).

function err(input: string, message: string): Command {
  return { kind: "error", input, message };
}

export function parseCommand(input: string): Command {
  const trimmed = input.trim();
  if (!trimmed) return err(input, "Empty command.");

  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (verb) {
    case "chart":
    case "quote":
    case "watch":
    case "unwatch": {
      if (args.length === 0) return err(input, `Usage: ${verb} <SYMBOL>`);
      return { kind: verb, symbol: args[0].toUpperCase() };
    }
    case "news":
      return { kind: "news", feed: args.length ? args.join(" ") : undefined };
    case "port":
      return { kind: "port" };
    case "yield":
      return { kind: "yield" };
    case "cal":
      return { kind: "cal" };
    case "help":
      return { kind: "help" };
    case "follow":
    case "unfollow": {
      const name = args.join(" ").trim();
      if (!name) return err(input, `Usage: ${verb} <name>`);
      return { kind: verb, name };
    }
    case "following":
      return { kind: "following" };
    case "settings":
      return { kind: "settings" };
    default:
      return err(input, `Unknown command: "${verb}". Type "help" for the command list.`);
  }
}
