export const theme = {
  bg: "#0f1115",
  bgElev: "#171a21",
  bgElev2: "#1f232d",
  border: "#262b36",
  text: "#f5f7fa",
  textMuted: "#8b92a0",
  textFaint: "#5a616d",
  accent: "#5b8def",
  accentDim: "#2b4a82",
  green: "#22c55e",
  greenDim: "#0f3b22",
  red: "#ef4444",
  redDim: "#461818",
  overlay: "rgba(0,0,0,0.55)",
};

export const categoryLabels: Record<"movie" | "tv" | "book", string> = {
  movie: "Movie",
  tv: "TV",
  book: "Book",
};

export const completionLabels: Record<
  "movie" | "tv" | "book",
  { incomplete: string; completed: string }
> = {
  movie: { incomplete: "Unwatched", completed: "Watched" },
  tv: { incomplete: "Unwatched", completed: "Watched" },
  book: { incomplete: "Unread", completed: "Read" },
};
