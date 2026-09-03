// The timeline is rendered by the group layout and never unmounts, so the
// routes inside this group render nothing themselves — the URL is what tells
// `SheetHost` which sheet belongs on top. See src/nav/sheetRoute.ts.
export default function TimelineRoute() {
  return null;
}
