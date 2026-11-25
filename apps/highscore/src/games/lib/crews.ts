// Pure copy helpers for the crew screens (spike #8), kept out of the
// components so they're testable without a renderer.

import type { CrewPreview } from "@workshop/shared/crews";

/** "4 members", "1 member". */
export function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** "Josh's crew" (creator's first name) / "A crew" when the creator is gone. */
export function crewKicker(preview: Pick<CrewPreview, "crew">): string {
  const first = preview.crew.creator?.displayName?.trim().split(/\s+/)[0];
  return first ? `${first}'s crew` : "A crew";
}

/** "Ann, Ben and Cat" / "Ann, Ben, Cat and 2 more". Empty for no names. */
export function memberNamesLine(names: readonly string[], total: number): string {
  if (names.length === 0) return "";
  const rest = total - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
