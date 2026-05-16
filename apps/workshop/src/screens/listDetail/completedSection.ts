// When the completed section grows past this many rows, the list auto-
// collapses it so the active part of the list (ranked + unordered) stays
// in view. The user can tap the section header to expand again. Five is
// roughly the height of one ranked + unordered combined block on a phone
// — small enough that a short list still shows everything, big enough
// that an actively-used shared list doesn't fold its own activity away.
export const COMPLETED_COLLAPSE_THRESHOLD = 5;
