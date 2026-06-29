/**
 * Re-mounts on every navigation, so its entrance animation replays each time -
 * the content fades and slides up instead of hard-cutting. Pure CSS.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="aem-enter">{children}</div>;
}
