import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Any ESM load of either package fails the test outright.
vi.mock("expo-contacts", () => {
  throw new Error("expo-contacts must not be loaded on this runtime");
});
vi.mock("expo-sms", () => {
  throw new Error("expo-sms must not be loaded on this runtime");
});
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock("expo-updates", () => ({ runtimeVersion: "1.3.0" }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.3.0" } } }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Share: { share: vi.fn(async () => ({ action: "sharedAction" })), sharedAction: "sharedAction" },
}));

import { type ContactsEnv, contacts, createContacts, runtimeHasContacts } from "./contacts";

type ContactsMod = ReturnType<ContactsEnv["loadContacts"]>;
type SmsMod = ReturnType<ContactsEnv["loadSms"]>;

function env(runtimeVersion: string | null, overrides: Partial<ContactsEnv> = {}): ContactsEnv {
  return {
    os: "ios",
    runtimeVersion,
    loadContacts: vi.fn(() => {
      throw new Error("must not load");
    }),
    loadSms: vi.fn(() => {
      throw new Error("must not load");
    }),
    ...overrides,
  };
}

describe("runtime gate", () => {
  it("only 1.4.0+ iOS binaries have contacts", () => {
    expect(runtimeHasContacts("ios", "1.3.0")).toBe(false);
    expect(runtimeHasContacts("ios", "1.4.0")).toBe(true);
    expect(runtimeHasContacts("ios", "1.10.0")).toBe(true);
    expect(runtimeHasContacts("ios", null)).toBe(false);
    expect(runtimeHasContacts("android", "9.9.9")).toBe(false);
    expect(runtimeHasContacts("web", "9.9.9")).toBe(false);
  });

  it.each(["1.2.0", "1.3.0", null])("never loads either module on runtime %s", async (rv) => {
    const e = env(rv);
    const facade = createContacts(e);
    expect(facade.isSupported()).toBe(false);
    expect(await facade.getAccess()).toBe("unsupported");
    expect(await facade.requestAccess()).toBe("unsupported");
    expect(await facade.readContacts()).toEqual([]);
    expect(facade.accessButton()).toBeNull();
    const invite = await facade.sendInvite(
      { id: "1", name: "Sam", emails: [], phones: ["+14155550101"] },
      "hi",
    );
    expect(invite.channel).toBe("share");
    expect(e.loadContacts).not.toHaveBeenCalled();
    expect(e.loadSms).not.toHaveBeenCalled();
  });

  it("the app instance on a 1.3.0 binary is unsupported", async () => {
    expect(contacts.isSupported()).toBe(false);
    expect(await contacts.getAccess()).toBe("unsupported");
  });

  it("a throwing require reads as unsupported", async () => {
    const facade = createContacts(env("1.4.0"));
    expect(facade.isSupported()).toBe(false);
  });
});

describe("on 1.4.0", () => {
  function fakeContacts(permission: object) {
    return {
      getPermissionsAsync: vi.fn(async () => permission),
      requestPermissionsAsync: vi.fn(async () => permission),
      ContactField: { FULL_NAME: "fullName", EMAILS: "emails", PHONES: "phones" },
      Contact: {
        getAllDetails: vi.fn(async () => [
          {
            id: "a",
            fullName: " Sam Rivera ",
            emails: [{ address: "sam@example.com" }, {}],
            phones: [{ number: "+14155550101" }],
          },
        ]),
        presentAccessPicker: vi.fn(async () => []),
      },
      ContactAccessButton: { isAvailable: () => true },
      addContactsChangeListener: vi.fn(() => ({ remove: vi.fn() })),
    } as unknown as ContactsMod;
  }

  it("maps iOS 18 limited and full access", async () => {
    const limited = createContacts(
      env("1.4.0", {
        loadContacts: () =>
          fakeContacts({ granted: true, status: "granted", accessPrivileges: "limited" }),
      }),
    );
    expect(await limited.requestAccess()).toBe("limited");
    const full = createContacts(
      env("1.4.0", {
        loadContacts: () =>
          fakeContacts({ granted: true, status: "granted", accessPrivileges: "all" }),
      }),
    );
    expect(await full.getAccess()).toBe("full");
    const denied = createContacts(
      env("1.4.0", { loadContacts: () => fakeContacts({ granted: false, status: "denied" }) }),
    );
    expect(await denied.getAccess()).toBe("denied");
  });

  it("reads name, emails and phones only", async () => {
    const facade = createContacts(
      env("1.4.0", {
        loadContacts: () =>
          fakeContacts({ granted: true, status: "granted", accessPrivileges: "all" }),
      }),
    );
    expect(await facade.readContacts()).toEqual([
      { id: "a", name: "Sam Rivera", emails: ["sam@example.com"], phones: ["+14155550101"] },
    ]);
  });

  it("invites by SMS when the contact has a number", async () => {
    const sendSMSAsync = vi.fn(async () => ({ result: "sent" as const }));
    const facade = createContacts(
      env("1.4.0", {
        loadSms: () => ({ isAvailableAsync: async () => true, sendSMSAsync }) as unknown as SmsMod,
      }),
    );
    const res = await facade.sendInvite(
      { id: "1", name: "Sam", emails: [], phones: ["+14155550101"] },
      "join me",
    );
    expect(res).toEqual({ channel: "sms", result: "sent" });
    expect(sendSMSAsync).toHaveBeenCalledWith(["+14155550101"], "join me");
  });
});

describe("only door", () => {
  it("no other file under src/ or app/ mentions expo-contacts or expo-sms", () => {
    const appRoot = join(__dirname, "..", "..");
    const self = join(__dirname, "contacts.ts");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && p !== self) {
          const text = readFileSync(p, "utf8");
          if (text.includes("expo-contacts") || text.includes("expo-sms")) {
            offenders.push(relative(appRoot, p));
          }
        }
      }
    };
    walk(join(appRoot, "src"));
    walk(join(appRoot, "app"));
    expect(offenders).toEqual([]);
  });
});
