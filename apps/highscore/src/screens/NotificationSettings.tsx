// `/settings/notifications` — the daily play reminder. Reads/writes
// `GET|PUT /v1/me/notification-prefs`; OS permission comes from the
// `pushNotifications` facade, so web and pre-1.2.0 binaries get the
// "update from the App Store" message instead of controls.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { NotificationPrefsResponse } from "@workshop/shared";
import { haptics } from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchNotificationPrefs, saveNotificationPrefs } from "../api/notifications";
import { openStoreUrl, useAppReleaseNudge } from "../hooks/useAppRelease";
import { useAuth } from "../hooks/useAuth";
import {
  getPermissionStatus,
  isPushSupported,
  type PushPermissionStatus,
} from "../lib/pushNotifications";
import { deviceTimezone, enablePlayReminder, formatReminderHour } from "../lib/pushRegistration";
import {
  Button,
  Card,
  Chip,
  IconButton,
  PixelIcon,
  Screen,
  Text,
  tokens,
  useToast,
} from "../theme";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function NotificationSettings() {
  const supported = isPushSupported();
  return (
    <Screen style={styles.root} testID="notification-settings">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            Settings
          </Text>
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            Notifications
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Close notification settings"
          onPress={() => goBack("/")}
          testID="notification-settings-close"
        >
          <PixelIcon name="close" size={24} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {supported ? <ReminderControls /> : <UnsupportedBuild />}
      </ScrollView>
    </Screen>
  );
}

function UnsupportedBuild() {
  const nudge = useAppReleaseNudge();
  const storeUrl = nudge.kind === "none" ? null : nudge.storeUrl;
  const web = Platform.OS === "web";
  return (
    <Card style={styles.card} testID="notification-settings-unsupported">
      <Text variant="heading">Daily play reminder</Text>
      <Text tone="secondary">
        {web
          ? "Reminders come from the HighScore iPhone app. Get it on the App Store to turn them on."
          : "Update HighScore on the App Store to turn on reminders."}
      </Text>
      <Button
        label={web ? "Get HighScore on the App Store" : "Update on the App Store"}
        onPress={() => openStoreUrl(storeUrl)}
        testID="notification-settings-open-store"
      />
    </Card>
  );
}

/** OS permission, re-read whenever the app comes back to the foreground (e.g. from Settings). */
function usePermissionStatus(): [PushPermissionStatus | null, () => void] {
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  const refresh = useCallback(() => {
    void getPermissionStatus().then(setStatus);
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return [status, refresh];
}

function ReminderControls() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [permission, refreshPermission] = usePermissionStatus();

  const prefsQuery = useQuery({
    queryKey: queryKeys.users.notificationPrefs,
    queryFn: () => fetchNotificationPrefs(token),
    enabled: !!token,
  });
  const prefs = prefsQuery.data;

  const setCached = (patch: Partial<NotificationPrefsResponse>) =>
    queryClient.setQueryData<NotificationPrefsResponse>(queryKeys.users.notificationPrefs, (p) =>
      p ? { ...p, ...patch } : p,
    );

  const save = useMutation({
    mutationFn: async (next: { enabled: boolean; hour: number | null }) => {
      if (!token || !user) throw new Error("Not signed in");
      if (next.enabled && permission !== "granted") {
        const result = await enablePlayReminder(token, user.id);
        refreshPermission();
        if (!result.ok) {
          throw new Error(
            result.status === "denied"
              ? "Allow notifications for HighScore in Settings first"
              : "Notifications aren't available",
          );
        }
        if (next.hour !== null && result.prefs.playReminderHour !== next.hour) {
          return saveNotificationPrefs(token, {
            playReminderEnabled: true,
            playReminderHour: next.hour,
          });
        }
        return result.prefs;
      }
      return saveNotificationPrefs(token, {
        playReminderEnabled: next.enabled,
        playReminderHour: next.hour,
      });
    },
    onSuccess: (saved) => setCached(saved),
    onError: (e) => {
      void prefsQuery.refetch();
      showToast({ message: errorMessage(e, "Couldn't save reminder"), tone: "danger" });
    },
  });

  if (!prefs) {
    return (
      <Card style={styles.card}>
        <Text tone="secondary">
          {prefsQuery.isError ? "Couldn't load your reminder settings." : "Loading…"}
        </Text>
        {prefsQuery.isError ? (
          <Button label="Try again" variant="secondary" onPress={() => void prefsQuery.refetch()} />
        ) : null}
      </Card>
    );
  }

  const enabled = prefs.playReminderEnabled;
  const hour = prefs.playReminderHour ?? prefs.suggestedHour;
  const denied = permission === "denied";

  return (
    <>
      <Card style={styles.card} testID="notification-permission">
        <Text variant="overline" tone="muted">
          iPhone notifications
        </Text>
        <Text>
          {permission === "granted"
            ? "Allowed"
            : denied
              ? "Off for HighScore. Reminders can't reach you until you allow them in Settings."
              : permission === "undetermined"
                ? "Not asked yet — turning on the reminder will ask."
                : "Checking…"}
        </Text>
        {denied ? (
          <Button
            label="Open Settings"
            variant="secondary"
            onPress={() => void Linking.openSettings().catch(() => {})}
            testID="notification-open-settings"
          />
        ) : null}
      </Card>

      <Card style={styles.card}>
        <ToggleRow
          label="Daily play reminder"
          detail={
            enabled
              ? `Around ${formatReminderHour(hour)}, unless you've already posted`
              : "One nudge a day when you haven't posted yet"
          }
          value={enabled}
          disabled={save.isPending}
          onChange={(next) => {
            setCached({ playReminderEnabled: next });
            save.mutate({ enabled: next, hour });
          }}
        />
        {enabled ? (
          <View style={styles.hours}>
            <Text variant="overline" tone="muted">
              Remind me at
            </Text>
            <View style={styles.chips} testID="reminder-hour-picker">
              {HOURS.map((h) => (
                <Chip
                  key={h}
                  label={formatReminderHour(h)}
                  selected={h === hour}
                  disabled={save.isPending}
                  onPress={() => {
                    if (h === hour) return;
                    haptics.selection();
                    setCached({ playReminderHour: h });
                    save.mutate({ enabled: true, hour: h });
                  }}
                  testID={`reminder-hour-${h}`}
                  style={styles.chip}
                />
              ))}
            </View>
            <Text variant="caption" tone="muted">
              Times are in your phone's time zone ({deviceTimezone()}).
            </Text>
          </View>
        ) : null}
      </Card>
    </>
  );
}

function ToggleRow({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      // RNW drops `accessibilityState` (root CLAUDE.md); `aria-checked` reaches the DOM.
      aria-checked={value}
      accessibilityLabel={label}
      testID="play-reminder-toggle"
      onPress={
        disabled
          ? undefined
          : () => {
              haptics.selection();
              onChange(!value);
            }
      }
      style={styles.toggleRow}
    >
      <View style={styles.toggleText}>
        <Text variant="label" style={styles.toggleLabel}>
          {label}
        </Text>
        <Text variant="caption" tone="muted">
          {detail}
        </Text>
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.thumb, value && styles.thumbOn]} />
      </View>
    </Pressable>
  );
}

const TRACK_W = 44;
const THUMB = 18;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 1 },
  body: { padding: tokens.space.lg, gap: tokens.space.lg, paddingBottom: tokens.space.xxl },
  card: { gap: tokens.space.md },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  toggleLabel: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  track: {
    width: TRACK_W,
    height: THUMB + 8,
    padding: 2,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
    justifyContent: "center",
  },
  trackOn: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.text.muted,
  },
  thumbOn: { backgroundColor: tokens.neon.pink, alignSelf: "flex-end" },
  hours: { gap: tokens.space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.xs },
  chip: { minWidth: 64 },
});
