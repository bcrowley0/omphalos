"use client";

import type { Tab } from "../lib/command/types";
import ChartWidget from "../widgets/ChartWidget";
import QuoteWidget from "../widgets/QuoteWidget";
import PortfolioWidget from "../widgets/PortfolioWidget";
import YieldWidget from "../widgets/YieldWidget";
import NewsWidget from "../widgets/NewsWidget";
import WatchlistWidget from "../widgets/WatchlistWidget";
import CalendarWidget from "../widgets/CalendarWidget";
import HelpWidget from "../widgets/HelpWidget";
import FollowingWidget from "../widgets/FollowingWidget";
import PersonFeedWidget from "../widgets/PersonFeedWidget";
import SettingsWidget from "../widgets/SettingsWidget";

// Render the widget for a tab. The `key` on the caller side ensures each tab
// gets its own component instance (and its own data fetch).
export default function WidgetHost({ tab }: { tab: Tab }) {
  switch (tab.widget) {
    case "chart":
      return <ChartWidget symbol={tab.symbol!} tabId={tab.id} />;
    case "quote":
      return <QuoteWidget symbol={tab.symbol!} tabId={tab.id} />;
    case "portfolio":
      return <PortfolioWidget tabId={tab.id} />;
    case "yield":
      return <YieldWidget />;
    case "news":
      return <NewsWidget feed={tab.feed} />;
    case "watchlist":
      return <WatchlistWidget tabId={tab.id} />;
    case "cal":
      return <CalendarWidget />;
    case "help":
      return <HelpWidget />;
    case "following":
      return <FollowingWidget />;
    case "person":
      return <PersonFeedWidget person={tab.person!} />;
    case "settings":
      return <SettingsWidget />;
  }
}
