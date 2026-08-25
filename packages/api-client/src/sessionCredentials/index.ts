// Platform-variant entry point — see `../storage/index.ts` for why the split
// lives behind a relative `./impl` hop instead of directly in `exports`.
export type { StoredSessionCredentials } from "./impl";
export {
  clearSessionCredentials,
  persistSessionCredentials,
  readSessionCredentials,
} from "./impl";
