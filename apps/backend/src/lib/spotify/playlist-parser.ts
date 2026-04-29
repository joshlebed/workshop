// Parse a user-pasted Spotify playlist URL or URI down to a bare playlist id.
// Accepted shapes:
//   https://open.spotify.com/playlist/<id>           (with or without query)
//   https://open.spotify.com/playlist/<id>?si=...
//   https://open.spotify.com/embed/playlist/<id>
//   spotify:playlist:<id>
// Returns the 22-character base62 id Spotify exposes everywhere.

const ID_REGEX = /^[A-Za-z0-9]{22}$/;

export class InvalidPlaylistUrlError extends Error {
  constructor(message = "not a Spotify playlist URL") {
    super(message);
    this.name = "InvalidPlaylistUrlError";
  }
}

export function parsePlaylistId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidPlaylistUrlError("playlist URL required");

  // spotify:playlist:<id>
  const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1] ?? throwInvalid();

  // open.spotify.com/[embed/]playlist/<id>[?...]
  const urlMatch = trimmed.match(
    /^https?:\/\/open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]{22})(?:[/?#].*)?$/,
  );
  if (urlMatch) return urlMatch[1] ?? throwInvalid();

  // bare id (defensive — backend never strips the URL on the way in but
  // some callers may pass a normalized id directly)
  if (ID_REGEX.test(trimmed)) return trimmed;

  throw new InvalidPlaylistUrlError();
}

function throwInvalid(): never {
  throw new InvalidPlaylistUrlError();
}
