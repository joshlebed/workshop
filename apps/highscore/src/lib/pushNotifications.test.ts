import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Any ESM load of the package fails the test outright.
vi.mock("expo-notifications", () => {
  throw new Error("expo-notifications must not be loaded on this runtime");
});
const updates = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return { runtimeVersion: "1.1.0" as string | null };
});
vi.mock("expo-updates", () => updates);
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.1.0", extra: { eas: { projectId: "p" } } } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import {
  createPushNotifications,
  getPermissionStatus,
  isPushSupported,
  notificationPath,
  type PushEnv,
  requestPermissionAndToken,
  runtimeHasPush,
} from "./pushNotifications";

type Mod = ReturnType<PushEnv["load"]>;

function fakeModule(permission: { granted: boolean; status: string }) {
  return {
    setNotificationHandler: vi.fn(),
    getPermissionsAsync: vi.fn(async () => permission),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true, status: "granted" })),
    getExpoPushTokenAsync: vi.fn(async () => ({ type: "expo", data: "ExponentPushToken[abc]" })),
    addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    getLastNotificationResponseAsync: vi.fn(async () => null),
  } as unknown as Mod;
}

function env(runtimeVersion: string | null, load: () => Mod, os = "ios"): PushEnv {
  return { os, runtimeVersion, projectId: "proj", load };
}

describe("runtime gate", () => {
  it("only 1.2.0+ native binaries have push", () => {
    expect(runtimeHasPush("ios", "1.0.1")).toBe(false);
    expect(runtimeHasPush("ios", "1.1.0")).toBe(false);
    expect(runtimeHasPush("ios", "1.2.0")).toBe(true);
    expect(runtimeHasPush("ios", "1.10.0")).toBe(true);
    expect(runtimeHasPush("ios", null)).toBe(false);
    expect(runtimeHasPush("ios", "garbage")).toBe(false);
    expect(runtimeHasPush("web", "9.9.9")).toBe(false);
  });

  it.each(["1.0.1", "1.1.0", null])("never loads expo-notifications on runtime %s", async (rv) => {
    const load = vi.fn(() => {
      throw new Error("must not load");
    });
    const push = createPushNotifications(env(rv, load));
    expect(push.isPushSupported()).toBe(false);
    expect(await push.getPermissionStatus()).toBe("unsupported");
    expect(await push.requestPermissionAndToken()).toEqual({ status: "unsupported", token: null });
    expect(await push.getPushToken()).toBeNull();
    push.addResponseListener(() => {})();
    expect(load).not.toHaveBeenCalled();
  });

  it("never loads it on web, whatever the version", () => {
    const load = vi.fn(() => fakeModule({ granted: true, status: "granted" }));
    expect(createPushNotifications(env("9.0.0", load, "web")).isPushSupported()).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("treats a throwing require as unsupported, and tries only once", async () => {
    const load = vi.fn(() => {
      throw new Error("Cannot find native module 'ExpoPushTokenManager'");
    });
    const push = createPushNotifications(env("1.2.0", load));
    expect(push.isPushSupported()).toBe(false);
    expect(await push.getPermissionStatus()).toBe("unsupported");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads lazily on 1.2.0, sets the foreground handler, mints a token", async () => {
    const m = fakeModule({ granted: false, status: "undetermined" });
    const load = vi.fn(() => m);
    const push = createPushNotifications(env("1.2.0", load));
    expect(load).not.toHaveBeenCalled();
    expect(await push.getPermissionStatus()).toBe("undetermined");
    expect(m.setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(await push.requestPermissionAndToken()).toEqual({
      status: "granted",
      token: "ExponentPushToken[abc]",
    });
    expect(m.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("getPushToken is null until permission is granted", async () => {
    const push = createPushNotifications(
      env("1.2.0", () => fakeModule({ granted: false, status: "denied" })),
    );
    expect(await push.getPermissionStatus()).toBe("denied");
    expect(await push.getPushToken()).toBeNull();
  });
});

describe("the app instance (mocked expo-updates runtime 1.1.0)", () => {
  beforeEach(() => {
    updates.runtimeVersion = "1.1.0";
  });
  it("is unsupported and never throws", async () => {
    expect(isPushSupported()).toBe(false);
    expect(await getPermissionStatus()).toBe("unsupported");
    expect((await requestPermissionAndToken()).status).toBe("unsupported");
  });
});

describe("source guard", () => {
  const appRoot = join(__dirname, "..", "..");
  const self = join(__dirname, "pushNotifications.ts");

  it("requires expo-notifications only inside the lazy loader, never at module scope", () => {
    const src = readFileSync(self, "utf8");
    expect(src).not.toMatch(/^import(?!\s+type)[^;]*from\s+"expo-notifications"/m);
    // Only the type-level `typeof import(...)` is allowed — no runtime import().
    expect(src).not.toMatch(/(?<!typeof )import\("expo-notifications"\)/);
    const requires = src.match(/require\("expo-notifications"\)/g) ?? [];
    expect(requires).toHaveLength(1);
    const loader =
      /function loadExpoNotifications\(\)[^{]*\{\s*return require\("expo-notifications"\)/;
    expect(src).toMatch(loader);
  });

  it("no other HighScore module references expo-notifications", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && p !== self) {
          if (readFileSync(p, "utf8").includes("expo-notifications")) {
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

describe("notificationPath", () => {
  it("maps HighScore links to routes and everything else to home", () => {
    expect(notificationPath("highscore:///")).toBe("/");
    expect(notificationPath("highscore:///games/abc")).toBe("/games/abc");
    expect(notificationPath("workshop:///games")).toBe("/");
    expect(notificationPath(null)).toBe("/");
    expect(notificationPath("highscore://")).toBe("/");
  });
});
