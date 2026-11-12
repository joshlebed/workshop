import { describe, expect, it } from "vitest";
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from "./legal";

const privacy = PRIVACY_SECTIONS.flatMap((s) => [...(s.body ?? []), ...(s.bullets ?? [])]).join(
  "\n",
);
const terms = TERMS_SECTIONS.flatMap((s) => [...(s.body ?? []), ...(s.bullets ?? [])]).join("\n");

// These sentences are what App Review and users rely on. Softening or dropping
// one should be a deliberate edit, so it fails here first.
describe("Workshop legal copy", () => {
  it("says deletion is in the app, immediate, and takes HighScore too", () => {
    expect(privacy).toMatch(/Settings, then Delete account/);
    expect(privacy).toMatch(/immediate and permanent/);
    expect(privacy).toMatch(/HighScore/);
    expect(terms).toMatch(/deleting it from either app deletes both/);
  });

  it("keeps the never-do promises", () => {
    expect(privacy).toMatch(/No selling or renting your data/);
    expect(privacy).toMatch(/No third-party advertising/);
    expect(privacy).toMatch(/No tracking you across other apps/);
  });

  it("is honest about Apple revocation and share logging", () => {
    expect(privacy).toMatch(/asks Apple to revoke/);
    expect(privacy).toMatch(/preview of what arrived is written to the server logs/);
  });

  it("uses no em dashes", () => {
    expect(privacy).not.toMatch(/—/);
    expect(terms).not.toMatch(/—/);
  });
});
