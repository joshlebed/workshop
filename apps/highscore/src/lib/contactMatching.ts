// Pure rules for "Find friends from contacts" — no React, no native module, so
// they are unit-tested (`contactMatching.test.ts`). The device side of the
// hashing scheme in `@workshop/shared/contacts`: contacts become digests here
// and only the digests are sent.

import {
  CONTACT_MATCH_KINDS,
  CONTACT_MATCH_MAX_HASHES,
  type ContactMatch,
  contactHandleDigest,
  normalizeEmail,
  normalizePhoneE164,
} from "@workshop/shared/contacts";
import type { DeviceContact } from "./contacts";

/** At most this many match calls per scan; leaves room in the 5/hour budget for a re-scan. */
export const MAX_MATCH_CALLS_PER_SCAN = 3;

/** Every digest a contact contributes, for the kinds the server can match. */
export function contactDigests(contact: DeviceContact, region: string | null): string[] {
  const out = new Set<string>();
  if (CONTACT_MATCH_KINDS.includes("email")) {
    for (const raw of contact.emails) {
      const email = normalizeEmail(raw);
      if (email) out.add(contactHandleDigest("email", email));
    }
  }
  if (CONTACT_MATCH_KINDS.includes("phone")) {
    for (const raw of contact.phones) {
      const phone = normalizePhoneE164(raw, region);
      if (phone) out.add(contactHandleDigest("phone", phone));
    }
  }
  return [...out];
}

export interface DigestIndex {
  /** digest → the contact ids that produced it. */
  byDigest: Map<string, string[]>;
  /** Unique digests, in contact order. */
  digests: string[];
}

export function indexDigests(contacts: DeviceContact[], region: string | null): DigestIndex {
  const byDigest = new Map<string, string[]>();
  for (const contact of contacts) {
    for (const d of contactDigests(contact, region)) {
      const ids = byDigest.get(d) ?? [];
      if (!ids.includes(contact.id)) ids.push(contact.id);
      byDigest.set(d, ids);
    }
  }
  return { byDigest, digests: [...byDigest.keys()] };
}

/**
 * The digests not yet checked, split into ≤500-digest calls, at most
 * `MAX_MATCH_CALLS_PER_SCAN` of them. `skipped` counts digests left for later.
 */
export function planMatchCalls(
  digests: string[],
  alreadyChecked: ReadonlySet<string>,
): { batches: string[][]; skipped: number } {
  const fresh = digests.filter((d) => !alreadyChecked.has(d));
  const batches: string[][] = [];
  for (
    let i = 0;
    i < fresh.length && batches.length < MAX_MATCH_CALLS_PER_SCAN;
    i += CONTACT_MATCH_MAX_HASHES
  ) {
    batches.push(fresh.slice(i, i + CONTACT_MATCH_MAX_HASHES));
  }
  const sent = batches.reduce((n, b) => n + b.length, 0);
  return { batches, skipped: fresh.length - sent };
}

export interface OnHighScoreRow {
  match: ContactMatch;
  /** The contact card's name, when it has one ("Sam in your contacts"). */
  contactName: string | null;
}

export interface ContactLists {
  onHighScore: OnHighScoreRow[];
  /** Contacts with no match and something to invite them by. */
  notYet: DeviceContact[];
}

/** The two lists the screen shows, from the readable contacts and the matches so far. */
export function partitionContacts(
  contacts: DeviceContact[],
  index: DigestIndex,
  matches: ContactMatch[],
): ContactLists {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const matchedContactIds = new Set<string>();
  const onHighScore: OnHighScoreRow[] = [];
  for (const match of matches) {
    let contactName: string | null = null;
    for (const d of match.digests) {
      for (const id of index.byDigest.get(d) ?? []) {
        matchedContactIds.add(id);
        contactName ??= byId.get(id)?.name || null;
      }
    }
    onHighScore.push({ match, contactName });
  }
  const notYet = contacts
    .filter((c) => !matchedContactIds.has(c.id))
    .filter((c) => c.phones.length > 0 || c.emails.length > 0)
    // Named contacts first, alphabetically; unnamed ones (just a number) last.
    .sort((a, b) => Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name));
  return { onHighScore, notYet };
}

/** Merge a new batch of matches into the ones already shown (same user = union of digests). */
export function mergeMatches(prev: ContactMatch[], next: ContactMatch[]): ContactMatch[] {
  const byUser = new Map(prev.map((m) => [m.userId, m]));
  for (const m of next) {
    const old = byUser.get(m.userId);
    byUser.set(
      m.userId,
      old ? { ...m, digests: [...new Set([...old.digests, ...m.digests])].sort() } : m,
    );
  }
  return [...byUser.values()].sort((a, b) =>
    (a.displayName ?? "").localeCompare(b.displayName ?? ""),
  );
}

/** The text sent with an invite. */
export function inviteMessage(inviteUrl: string): string {
  return `Come compare daily game scores with me on HighScore: ${inviteUrl}`;
}

/** The label under a "Not yet on HighScore" row: what the invite goes to. */
export function inviteChannelLabel(contact: DeviceContact): string {
  if (contact.phones.length > 0) return contact.phones[0] ?? "";
  return contact.emails[0] ?? "";
}

/**
 * What the consent screen (`ContactsFinder`) promises before the OS prompt.
 * Each line must stay literally true; `contactMatching.test.ts` pins them, and
 * the privacy page (`legal.ts`) says the same.
 */
export const CONTACTS_CONSENT_POINTS = [
  {
    title: "What's sent",
    body: "For each email address on the contacts you share, a one-way code (a hash) made on this phone. Never names, phone numbers or addresses.",
  },
  {
    title: "What's kept",
    body: "Nothing. The codes are compared with people who chose to be findable, then thrown away.",
  },
  {
    title: "You choose who",
    body: "iOS lets you share just a few contacts. You can add more later, or change it in Settings.",
  },
  {
    title: "Being found",
    body: "Only people who turn on “Let friends find me” can show up here, and you can turn yours off any time below.",
  },
] as const;
