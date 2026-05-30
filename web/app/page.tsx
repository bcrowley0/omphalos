import Terminal from "./components/Terminal";

// The app is the terminal. Tabs and watchlist are restored client-side from
// localStorage (via the terminal store + useSyncExternalStore), so this server
// component just mounts the client shell.
export default function Home() {
  return <Terminal />;
}
