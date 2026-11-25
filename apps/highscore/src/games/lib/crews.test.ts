import { describe, expect, it } from "vitest";
import { crewKicker, memberCountLabel, memberNamesLine } from "./crews";

const crew = (displayName: string | null) => ({
  crew: {
    id: "c",
    name: "Sunday Puzzlers",
    memberCount: 4,
    maxMembers: 25,
    creator: displayName === null ? null : { userId: "u", displayName },
    memberFirstNames: [],
  },
});

describe("crew copy", () => {
  it("counts members", () => {
    expect(memberCountLabel(1)).toBe("1 member");
    expect(memberCountLabel(4)).toBe("4 members");
  });

  it("names the crew after its creator's first name", () => {
    expect(crewKicker(crew("Josh Lebedinsky"))).toBe("Josh's crew");
    expect(crewKicker(crew("  "))).toBe("A crew");
    expect(crewKicker(crew(null))).toBe("A crew");
  });

  it("lists first names, then how many more", () => {
    expect(memberNamesLine([], 0)).toBe("");
    expect(memberNamesLine(["Ann"], 1)).toBe("Ann");
    expect(memberNamesLine(["Ann", "Ben", "Cat"], 3)).toBe("Ann, Ben and Cat");
    expect(memberNamesLine(["Ann", "Ben"], 4)).toBe("Ann, Ben and 2 more");
  });
});
