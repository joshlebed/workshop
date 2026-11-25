// The ONLY module in HighScore that may load `expo-contacts` or `expo-sms`.
//
// Both native modules exist only in the 1.4.0+ binary, but every OTA also
// ships to the 1.3.0 binary (supported-runtimes.json). Loading either on an
// older binary throws `Cannot find native module …`, so — exactly like
// `pushNotifications.ts` — this facade:
//   1. reports unsupported on web, Android, and any runtime below 1.4.0,
//   2. only then `require`s the package, lazily inside a function (Metro still
//      bundles it; the module factory just never runs on an old binary),
//   3. treats a throwing require as unsupported.
// Everything else is `import type`, which is erased.
//
// Access model (expo-contacts 58, iOS 18+): `requestPermissionsAsync()` shows
// the system prompt, where the user picks "Select contacts" (limited) or
// "Share all" (full). Under limited access only the chosen contacts are
// readable; `presentAccessPicker()` and the `ContactAccessButton` view let the
// user share more without a second prompt. Below iOS 18 the choice is all or
// nothing.

import Constants from "expo-constants";
import * as Updates from "expo-updates";
import type { ComponentType } from "react";
import { Platform, Share } from "react-native";
import { compareReleaseVersions } from "./appRelease";

type ContactsModule = typeof import("expo-contacts");
type SmsModule = typeof import("expo-sms");
type AccessButtonProps = import("expo-contacts").ContactAccessButtonProps;

/** First binary that contains the `expo-contacts` and `expo-sms` native modules. */
export const CONTACTS_MIN_RUNTIME = "1.4.0";

export type ContactsAccess = "unsupported" | "undetermined" | "limited" | "full" | "denied";

/** One contact as read on the device. Never leaves it: only digests are sent. */
export interface DeviceContact {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
}

export type InviteResult = "sent" | "cancelled" | "unknown" | "failed";

export interface ContactsEnv {
  os: string;
  runtimeVersion: string | null;
  loadContacts: () => ContactsModule;
  loadSms: () => SmsModule;
  /** `__DEV__` web only: pretend contacts work so the UI can be exercised. */
  fake?: boolean;
}

export interface ContactsFacade {
  isSupported(): boolean;
  getAccess(): Promise<ContactsAccess>;
  /** The OS prompt when undetermined; returns the resulting access. */
  requestAccess(): Promise<ContactsAccess>;
  /** Every contact readable under the current access (all, or the limited set). */
  readContacts(): Promise<DeviceContact[]>;
  /** iOS 18 limited access: the system picker to share more contacts. */
  presentAccessPicker(): Promise<void>;
  /** The system `ContactAccessButton` (iOS 18+), or null. */
  accessButton(): ComponentType<AccessButtonProps> | null;
  /** Called when the readable contacts change (e.g. after the picker). */
  addChangeListener(listener: () => void): () => void;
  /** The in-app Messages composer, prefilled; falls back to the share sheet without a number. */
  sendInvite(
    contact: DeviceContact,
    message: string,
  ): Promise<{
    channel: "sms" | "share";
    result: InviteResult;
  }>;
}

/** True when this binary has the native modules (pure gate; no require). */
export function runtimeHasContacts(os: string, runtimeVersion: string | null): boolean {
  if (os !== "ios") return false;
  if (!runtimeVersion) return false;
  const cmp = compareReleaseVersions(runtimeVersion, CONTACTS_MIN_RUNTIME);
  return cmp !== null && cmp >= 0;
}

function accessFrom(p: {
  granted: boolean;
  status: string;
  accessPrivileges?: "all" | "limited" | "none";
}): ContactsAccess {
  if (p.granted) return p.accessPrivileges === "limited" ? "limited" : "full";
  if (p.status === "denied") return "denied";
  return "undetermined";
}

async function shareInvite(message: string): Promise<InviteResult> {
  try {
    const res = await Share.share({ message });
    return res.action === Share.sharedAction ? "sent" : "cancelled";
  } catch {
    return "failed";
  }
}

const FAKE_CONTACTS: DeviceContact[] = [
  { id: "fake-1", name: "Sam Rivera", emails: ["sam@example.com"], phones: ["+14155550101"] },
  { id: "fake-2", name: "Riley Chen", emails: [], phones: ["(415) 555-0102"] },
  { id: "fake-3", name: "Quinn Park", emails: ["quinn@example.com"], phones: [] },
];

function createFake(): ContactsFacade {
  let access: ContactsAccess = "undetermined";
  return {
    isSupported: () => true,
    getAccess: async () => access,
    requestAccess: async () => {
      access = "limited";
      return access;
    },
    readContacts: async () => (access === "limited" || access === "full" ? FAKE_CONTACTS : []),
    presentAccessPicker: async () => {},
    accessButton: () => null,
    addChangeListener: () => () => {},
    sendInvite: async (_contact, message) => ({
      channel: "share",
      result: await shareInvite(message),
    }),
  };
}

export function createContacts(env: ContactsEnv): ContactsFacade {
  if (env.fake) return createFake();

  let contacts: ContactsModule | null | undefined;
  let sms: SmsModule | null | undefined;

  function mod(): ContactsModule | null {
    if (contacts !== undefined) return contacts;
    if (!runtimeHasContacts(env.os, env.runtimeVersion)) {
      contacts = null;
      return contacts;
    }
    try {
      contacts = env.loadContacts();
    } catch {
      contacts = null;
    }
    return contacts;
  }

  function smsMod(): SmsModule | null {
    if (sms !== undefined) return sms;
    if (!runtimeHasContacts(env.os, env.runtimeVersion)) {
      sms = null;
      return sms;
    }
    try {
      sms = env.loadSms();
    } catch {
      sms = null;
    }
    return sms;
  }

  return {
    isSupported: () => mod() !== null,

    async getAccess() {
      const m = mod();
      if (!m) return "unsupported";
      try {
        return accessFrom(await m.getPermissionsAsync());
      } catch {
        return "unsupported";
      }
    },

    async requestAccess() {
      const m = mod();
      if (!m) return "unsupported";
      try {
        return accessFrom(await m.requestPermissionsAsync());
      } catch {
        return "unsupported";
      }
    },

    async readContacts() {
      const m = mod();
      if (!m) return [];
      const fields = [
        m.ContactField.FULL_NAME,
        m.ContactField.EMAILS,
        m.ContactField.PHONES,
      ] as const;
      const rows = await m.Contact.getAllDetails(fields);
      return rows.map((row) => ({
        id: row.id,
        name: row.fullName?.trim() || "",
        emails: (row.emails ?? []).flatMap((e) => (e.address ? [e.address] : [])),
        phones: (row.phones ?? []).flatMap((p) => (p.number ? [p.number] : [])),
      }));
    },

    async presentAccessPicker() {
      const m = mod();
      if (!m) return;
      try {
        await m.Contact.presentAccessPicker();
      } catch {
        /* below iOS 18, or already presented */
      }
    },

    accessButton() {
      const m = mod();
      if (!m) return null;
      try {
        return m.ContactAccessButton.isAvailable() ? m.ContactAccessButton : null;
      } catch {
        return null;
      }
    },

    addChangeListener(listener) {
      const m = mod();
      if (!m) return () => {};
      try {
        const sub = m.addContactsChangeListener(listener);
        return () => sub.remove();
      } catch {
        return () => {};
      }
    },

    async sendInvite(contact, message) {
      const phone = contact.phones[0];
      const s = smsMod();
      if (phone && s) {
        try {
          if (await s.isAvailableAsync()) {
            const res = await s.sendSMSAsync([phone], message);
            return { channel: "sms", result: res.result };
          }
        } catch {
          /* fall through to the share sheet */
        }
      }
      return { channel: "share", result: await shareInvite(message) };
    },
  };
}

// --- The app's instance -----------------------------------------------------

/** The lazy loaders. The only `expo-contacts` / `expo-sms` value references in the app. */
function loadExpoContacts(): ContactsModule {
  return require("expo-contacts") as ContactsModule;
}
function loadExpoSms(): SmsModule {
  return require("expo-sms") as SmsModule;
}

// `__DEV__` web only: `?fakeContactsSupported=1` exercises the contacts screen
// in a browser with three made-up contacts. Read once per page load.
const DEV_FAKE_CONTACTS =
  __DEV__ &&
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("fakeContactsSupported") === "1";

export const contacts: ContactsFacade = createContacts({
  os: Platform.OS,
  // `appVersion` runtime policy: runtime version === the binary's app.json version.
  runtimeVersion: Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
  loadContacts: loadExpoContacts,
  loadSms: loadExpoSms,
  fake: DEV_FAKE_CONTACTS,
});

/** The device's ISO region ("US"), for reading phone numbers written without a country code. */
export function deviceRegion(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const match = /[-_]([A-Z]{2})(?:[-_]|$)/.exec(locale);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
