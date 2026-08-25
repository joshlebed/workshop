// Platform-variant entry point.
//
// Metro applies `.web.ts` / `.native.ts` resolution to *relative* imports, but
// **not** to files it reaches through a package's `exports` map (those are an
// exact `fileSystemLookup`). So the exported subpath is this fixed shim, and
// the platform split happens one relative hop later on `./impl`.
export { getItem, removeItem, setItem } from "./impl";
