const DEFAULT_DEV_EMAIL = "joshlebed@gmail.com";
const DEFAULT_DEV_DISPLAY_NAME = "Josh";

/**
 * Dev auth stays backend-gated by DEV_AUTH_ENABLED. The optional identity
 * override lets isolated E2E and screenshot builds avoid signing into a
 * production-cloned account while preserving the normal local default.
 */
export const DEV_AUTH_USER = {
  email: process.env.EXPO_PUBLIC_DEV_AUTH_EMAIL?.trim() || DEFAULT_DEV_EMAIL,
  displayName: process.env.EXPO_PUBLIC_DEV_AUTH_DISPLAY_NAME?.trim() || DEFAULT_DEV_DISPLAY_NAME,
};
