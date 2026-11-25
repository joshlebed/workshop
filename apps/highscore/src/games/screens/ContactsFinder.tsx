// "Find friends from contacts" (onboarding spike #3) — `/friends/contacts`.
//
// Consent first: the screen says what is sent (a one-way code per email
// address), what is kept (nothing), and how to stop being findable, before the
// OS prompt. Then two lists:
//   On HighScore      — discoverable people whose email is on a shared contact,
//                       one-tap Add (a directed request) / Accept.
//   Not yet on HighScore — every other shared contact, one-tap Invite (the
//                       in-app Messages composer with the friend-invite link,
//                       else the share sheet).
// iOS 18 limited access is the expected answer: the screen keeps offering
// "Choose more contacts" (system picker) and the system ContactAccessButton.
// Every step reports a funnel event (`reportContactEvent`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import {
  acceptFriendRequestFrom,
  createFriendInvite,
  sendFriendRequest,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ContactMatch } from "@workshop/shared/contacts";
import { haptics } from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { matchContactDigests, reportContactEvent } from "../../api/contacts";
import {
  CONTACTS_CONSENT_POINTS,
  indexDigests,
  inviteChannelLabel,
  inviteMessage,
  mergeMatches,
  partitionContacts,
  planMatchCalls,
} from "../../lib/contactMatching";
import {
  type ContactsAccess,
  contacts,
  type DeviceContact,
  deviceRegion,
} from "../../lib/contacts";
import {
  Avatar,
  Button,
  bodyType,
  PixelIcon,
  Screen,
  sectionLabelType,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { DiscoverabilityCard } from "../components/DiscoverabilityCard";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { goBack } from "../lib/navigation";
import { useGamesRuntime } from "../runtime";

type Phase = "loading" | "unsupported" | "consent" | "denied" | "ready";

/**
 * What this app session already checked, per signed-in user: the digests sent
 * and the matches they returned. Re-opening the screen (or reaching it from
 * the post-accept step) then sends only new digests, so a few visits can't
 * burn the 5-calls-an-hour budget and come back to an empty list.
 */
const sessionCache: { userId: string | null; checked: Set<string>; matches: ContactMatch[] } = {
  userId: null,
  checked: new Set(),
  matches: [],
};

function cacheFor(userId: string | null) {
  if (sessionCache.userId !== userId) {
    sessionCache.userId = userId;
    sessionCache.checked = new Set();
    sessionCache.matches = [];
  }
  return sessionCache;
}

export default function ContactsFinder() {
  const { token, routes, user } = useGamesRuntime();
  const cache = cacheFor(user?.id ?? null);
  const params = useLocalSearchParams<{ surface?: string }>();
  const surface = params.surface === "post_accept" ? "post_accept" : "friends";
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const openProfile = useOpenProfile();

  const [phase, setPhase] = useState<Phase>("loading");
  const [access, setAccess] = useState<ContactsAccess>("unsupported");
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [matches, setMatches] = useState<ContactMatch[]>(cache.matches);
  const [checking, setChecking] = useState(false);
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [invited, setInvited] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const checked = useRef(cache.checked);
  const promptReported = useRef(false);
  const region = useMemo(() => deviceRegion(), []);

  useEffect(() => {
    cache.matches = matches;
  }, [cache, matches]);

  const index = useMemo(() => indexDigests(deviceContacts, region), [deviceContacts, region]);
  const lists = useMemo(
    () => partitionContacts(deviceContacts, index, matches),
    [deviceContacts, index, matches],
  );

  /** Read the shared contacts and check any digests not checked yet. */
  const runScan = useCallback(async () => {
    const list = await contacts.readContacts().catch(() => [] as DeviceContact[]);
    setDeviceContacts(list);
    const plan = planMatchCalls(indexDigests(list, region).digests, checked.current);
    if (plan.batches.length === 0) return list.length;
    setChecking(true);
    try {
      for (const batch of plan.batches) {
        const res = await matchContactDigests(batch, surface, token);
        for (const d of batch) checked.current.add(d);
        setMatches((prev) => mergeMatches(prev, res.matches));
      }
      setLimitNote(
        plan.skipped > 0
          ? `Checked the first ${checked.current.size} email addresses. Come back in an hour for the rest.`
          : null,
      );
    } catch (e) {
      setLimitNote(
        e instanceof ApiError && e.status === 429
          ? "You've checked a lot of contacts in the last hour. Try again later."
          : errorMessage(e, "Couldn't check your contacts."),
      );
    } finally {
      setChecking(false);
    }
    return list.length;
  }, [region, surface, token]);

  // One scan at a time: the OS prompt backgrounds the app, so the grant and the
  // AppState "active" refresh both ask for a scan at once. A request during a
  // scan runs once more after it, so a mid-scan grant is never missed and the
  // same digests are never sent twice.
  const inFlight = useRef<Promise<number> | null>(null);
  const again = useRef(false);
  const scan = useCallback(async (): Promise<number> => {
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      let count = await runScan();
      while (again.current) {
        again.current = false;
        count = await runScan();
      }
      return count;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [runScan]);

  const applyAccess = useCallback(
    async (next: ContactsAccess) => {
      setAccess(next);
      if (next === "unsupported") setPhase("unsupported");
      else if (next === "denied") setPhase("denied");
      else if (next === "undetermined") {
        setPhase("consent");
        if (!promptReported.current) {
          promptReported.current = true;
          void reportContactEvent("prompt_shown", token, { detail: surface });
        }
      } else {
        setPhase("ready");
        await scan();
      }
    },
    [scan, surface, token],
  );

  // Initial state, and again whenever the app returns (Settings may have changed access).
  useEffect(() => {
    void contacts.getAccess().then(applyAccess);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void contacts.getAccess().then(applyAccess);
    });
    return () => sub.remove();
  }, [applyAccess]);

  // The limited set grew (picker / ContactAccessButton): rescan, debounced so a
  // run of single-contact grants spends one match call, not one each.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = contacts.addChangeListener(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void scan(), 1500);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [scan]);

  const onAllow = async () => {
    const next = await contacts.requestAccess();
    if (next === "limited" || next === "full") {
      setAccess(next);
      setPhase("ready");
      const count = await scan();
      void reportContactEvent(next === "limited" ? "limited_granted" : "full_granted", token, {
        count,
        detail: surface,
      });
    } else {
      if (next === "denied") void reportContactEvent("denied", token, { detail: surface });
      await applyAccess(next);
    }
  };

  const onChooseMore = async () => {
    void reportContactEvent("picker_opened", token, { detail: surface });
    await contacts.presentAccessPicker();
    await scan();
  };

  const setRelationship = (userId: string, relationship: ContactMatch["relationship"]) =>
    setMatches((prev) => prev.map((m) => (m.userId === userId ? { ...m, relationship } : m)));

  const addMutation = useMutation({
    mutationFn: async (match: ContactMatch) => {
      setBusyIds((ids) => [...ids, match.userId]);
      return match.relationship === "incoming"
        ? { status: "accepted" as const, ...(await acceptFriendRequestFrom(match.userId, token)) }
        : await sendFriendRequest(match.userId, token);
    },
    onSuccess: async (data, match) => {
      haptics.medium();
      void reportContactEvent("add", token, { targetUserId: match.userId, detail: surface });
      if (data.status === "accepted") {
        setRelationship(match.userId, "friend");
        showToast({
          message: `You're now friends with ${match.displayName?.trim() || "them"}!`,
          tone: "success",
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
          queryClient.invalidateQueries({ queryKey: ["games"] }),
        ]);
      } else {
        setRelationship(match.userId, "outgoing");
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
    onSettled: (_d, _e, match) => setBusyIds((ids) => ids.filter((id) => id !== match.userId)),
  });

  const inviteLink = useQuery({
    queryKey: ["contacts", "invite-link"],
    queryFn: () => createFriendInvite(token),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const onInvite = async (contact: DeviceContact) => {
    setBusyIds((ids) => [...ids, contact.id]);
    try {
      const link = inviteLink.data ?? (await inviteLink.refetch()).data;
      if (!link) throw new Error("no invite link");
      void reportContactEvent("invite_opened", token, { detail: surface });
      const { channel, result } = await contacts.sendInvite(contact, inviteMessage(link.url));
      if (result === "sent") {
        haptics.medium();
        void reportContactEvent("invite_sent", token, { detail: channel });
      }
      // The share sheet can't say whether a copied link was sent on (iOS reports
      // Copy as dismissed), so any close of it reads as invited; a cancelled
      // Messages composer doesn't. Only a confirmed send is counted above.
      if (result === "sent" || (channel === "share" && result !== "failed")) {
        setInvited((ids) => [...ids, contact.id]);
      }
      if (result === "failed") {
        showToast({ message: "Couldn't open the invite.", tone: "danger" });
      }
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't open the invite."), tone: "danger" });
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== contact.id));
    }
  };

  const AccessButton = phase === "ready" && access === "limited" ? contacts.accessButton() : null;

  return (
    <Screen testID="contacts-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack(routes.friends)}
          testID="contacts-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="title">Find friends</Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {phase === "loading" ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : phase === "unsupported" ? (
          <View style={styles.card} testID="contacts-unsupported">
            <Text variant="heading">Finding friends from contacts is in the iPhone app</Text>
            <Text tone="secondary">
              Update HighScore from the App Store to use it. You can still turn on being findable
              below, and share your invite link from Friends.
            </Text>
          </View>
        ) : phase === "consent" ? (
          <View style={styles.card} testID="contacts-consent">
            <Text variant="heading">Find friends from your contacts</Text>
            {CONTACTS_CONSENT_POINTS.map((p) => (
              <View key={p.title} style={styles.point}>
                <Text variant="label" style={styles.pointTitle}>
                  {p.title}
                </Text>
                <Text variant="caption" tone="secondary">
                  {p.body}
                </Text>
              </View>
            ))}
            <Button label="Choose contacts" onPress={onAllow} testID="contacts-allow" />
            <Text variant="caption" tone="muted">
              iOS asks next. "Select Contacts" shares only the ones you pick.
            </Text>
          </View>
        ) : phase === "denied" ? (
          <View style={styles.card} testID="contacts-denied">
            <Text variant="heading">Contacts are off for HighScore</Text>
            <Text tone="secondary">
              To find friends this way, allow contacts in Settings. You can pick just a few.
            </Text>
            <Button
              label="Open Settings"
              variant="secondary"
              onPress={() => void Linking.openSettings().catch(() => {})}
              testID="contacts-open-settings"
            />
          </View>
        ) : (
          <>
            <View style={styles.card} testID="contacts-access">
              <Text variant="caption" tone="secondary" testID="contacts-access-summary">
                {access === "limited"
                  ? `You're sharing ${deviceContacts.length} contact${deviceContacts.length === 1 ? "" : "s"} with HighScore.`
                  : `HighScore can see all ${deviceContacts.length} of your contacts. Only one-way codes of their emails were sent.`}
              </Text>
              {access === "limited" ? (
                <Button
                  label="Choose more contacts"
                  variant="secondary"
                  onPress={onChooseMore}
                  testID="contacts-choose-more"
                />
              ) : null}
              {AccessButton ? (
                <View style={styles.searchBlock}>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search for someone to share"
                    placeholderTextColor={tokens.text.muted}
                    style={styles.searchInput}
                    autoCorrect={false}
                    testID="contacts-search"
                  />
                  {search.trim() ? (
                    <AccessButton
                      query={search.trim()}
                      caption="email"
                      backgroundColor={tokens.bg.elevated}
                      textColor={tokens.text.primary}
                      tintColor={tokens.neon.pink}
                      style={styles.accessButton}
                    />
                  ) : null}
                </View>
              ) : null}
              {checking ? (
                <View style={styles.checkingRow}>
                  <ActivityIndicator size="small" color={tokens.accent.default} />
                  <Text variant="caption" tone="muted">
                    Checking who's on HighScore…
                  </Text>
                </View>
              ) : null}
              {limitNote ? (
                <Text variant="caption" tone="muted" testID="contacts-limit-note">
                  {limitNote}
                </Text>
              ) : null}
            </View>

            <View style={styles.list} testID="contacts-on-highscore">
              <Text style={styles.listLabel}>On HighScore</Text>
              {lists.onHighScore.length === 0 ? (
                <Text variant="caption" tone="muted">
                  {checking
                    ? "Checking…"
                    : "Nobody you've shared is findable on HighScore yet. Invite them below."}
                </Text>
              ) : (
                lists.onHighScore.map(({ match, contactName }) => {
                  const name = match.displayName?.trim() || "Someone";
                  const busy = busyIds.includes(match.userId);
                  return (
                    <View
                      key={match.userId}
                      style={styles.row}
                      testID={`contacts-match-${match.userId}`}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View ${name}'s profile`}
                        onPress={() => openProfile(match.userId)}
                        style={styles.identity}
                      >
                        <Avatar
                          name={match.displayName}
                          imageUrl={userAvatarImageUrl(match.userId)}
                          size="md"
                        />
                        <View style={styles.rowText}>
                          <Text variant="label" numberOfLines={1} style={styles.rowName}>
                            {name}
                          </Text>
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {contactName ? `${contactName} in your contacts` : "In your contacts"}
                          </Text>
                        </View>
                      </Pressable>
                      {match.relationship === "friend" ? (
                        <Text variant="label" style={styles.doneLabel}>
                          Friends
                        </Text>
                      ) : match.relationship === "outgoing" ? (
                        <Text
                          variant="label"
                          style={styles.doneLabel}
                          testID={`contacts-requested-${match.userId}`}
                        >
                          Requested
                        </Text>
                      ) : (
                        <Button
                          label={match.relationship === "incoming" ? "Accept" : "Add"}
                          onPress={() => addMutation.mutate(match)}
                          loading={busy}
                          disabled={busy}
                          testID={`contacts-add-${match.userId}`}
                        />
                      )}
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.list} testID="contacts-not-yet">
              <Text style={styles.listLabel}>Not yet on HighScore</Text>
              {lists.notYet.length === 0 ? (
                <Text variant="caption" tone="muted">
                  {access === "limited"
                    ? "Share more contacts above to invite them."
                    : "No other contacts with a phone number or email."}
                </Text>
              ) : (
                lists.notYet.map((contact) => {
                  const busy = busyIds.includes(contact.id);
                  const done = invited.includes(contact.id);
                  const label = contact.name || inviteChannelLabel(contact);
                  return (
                    <View
                      key={contact.id}
                      style={styles.row}
                      testID={`contacts-invite-row-${contact.id}`}
                    >
                      <View style={styles.identity}>
                        <Avatar name={label} imageUrl={null} size="md" />
                        <View style={styles.rowText}>
                          <Text variant="label" numberOfLines={1} style={styles.rowName}>
                            {label}
                          </Text>
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {contact.phones.length > 0
                              ? "Invite by message"
                              : "Invite by email or link"}
                          </Text>
                        </View>
                      </View>
                      {done ? (
                        <Text variant="label" style={styles.doneLabel}>
                          Invited
                        </Text>
                      ) : (
                        <Button
                          label="Invite"
                          variant="secondary"
                          onPress={() => void onInvite(contact)}
                          loading={busy}
                          disabled={busy}
                          testID={`contacts-invite-${contact.id}`}
                        />
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        <DiscoverabilityCard token={token} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xl },
  card: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  point: { gap: 2 },
  pointTitle: { ...bodyType("semibold"), color: tokens.text.primary },
  searchBlock: { gap: tokens.space.sm },
  searchInput: {
    ...bodyType("regular"),
    // ≥16 so iOS Safari never zooms (root CLAUDE.md); native ignores it.
    fontSize: tokens.font.size.md,
    color: tokens.text.primary,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
  },
  accessButton: { minHeight: 52 },
  checkingRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  list: { gap: tokens.space.sm },
  listLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: {
    ...bodyType("medium"),
    fontSize: tokens.font.size.md,
    lineHeight: 22,
    color: tokens.text.primary,
  },
  doneLabel: {
    ...bodyType("semibold"),
    color: tokens.text.muted,
    paddingHorizontal: tokens.space.sm,
  },
});
