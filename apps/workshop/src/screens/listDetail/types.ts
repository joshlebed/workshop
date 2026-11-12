/**
 * The list-detail screen's sections (docs/list-types.md → "Order"):
 *
 * - `open`: the list itself, one hand-ordered sequence. Every row drags.
 * - `inbox`: lists with a source only: rows a sync brought in that nobody has
 *   placed yet ("New from Spotify"), newest first. A row drags into the list
 *   or joins it from its menu; the inbox itself does not reorder.
 * - `completed`: Done. Rows reopen from the checkbox or the menu; they never drag.
 */
export type Section = "open" | "inbox" | "completed";
