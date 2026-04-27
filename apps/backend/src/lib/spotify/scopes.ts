// Scopes requested when a user connects Spotify. Mirrors lib-sync's set
// (read library + playlists, modify playlists) and adds the playback-history
// scopes that this app uses for "now playing" and "recent listens".
//
// Spotify shows the user this exact list during consent; keep it as small as
// the features actually need.
export const SPOTIFY_SCOPES: readonly string[] = [
  "user-read-email",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
] as const;

export const SPOTIFY_SCOPE_STRING = SPOTIFY_SCOPES.join(" ");
