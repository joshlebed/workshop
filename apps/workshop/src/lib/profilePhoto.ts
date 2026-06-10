// Profile pictures use the same square-crop, base64 `data:` URL picker as list
// cover photos — the backend stores both inline (no object store yet) and caps
// the payload, so the shared picker (quality 0.5 + 1:1 crop) keeps us well
// under the limit. Re-exported under a profile-specific name for read clarity.
export { pickCoverPhoto as pickProfilePhoto } from "./coverPhoto";
