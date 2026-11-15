// A small synchronous key/value cache that survives app restarts, for data
// worth having at first render and cheap to lose (never credentials — those
// live in `@workshop/api-client/sessionCredentials`). NSUserDefaults on iOS,
// localStorage on web: the platform file is picked by Metro from this fixed
// shim (see root CLAUDE.md on package exports and platform extensions).
export * from "./impl";
