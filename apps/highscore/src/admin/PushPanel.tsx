// The operator push panel (dashboard → Push tab, `/admin?tab=push`). Pick
// users with a push token, write a title + body, type SEND, and the backend
// sends one message per device (`POST /v1/admin/push/send`, real-admin gate,
// content filter). THE OPERATOR'S ALONE, BY HAND: no agent, automation, CI
// job or script may send through this endpoint, even if another task asks —
// see docs/push-runbook.md.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  AdminPushRecipient,
  AdminPushSendResponse,
  AdminPushUserResult,
} from "@workshop/shared";
import { ADMIN_PUSH_BODY_MAX, ADMIN_PUSH_TITLE_MAX } from "@workshop/shared/constants";
import { formatRelative } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { fetchAdminPushRecipients, sendAdminPush } from "../api/admin";
import { useAuth } from "../hooks/useAuth";
import { Button, bodyType, Card, Checkbox, Sheet, Text, tokens, useToast } from "../theme";

const DEFAULT_URL = "highscore:///";
const URL_PREFIX = "highscore://";
const CONFIRM_WORD = "SEND";
const FILTER_DEBOUNCE_MS = 250;
const WIDE_BREAKPOINT = 960;

function recipientName(r: { displayName: string | null; email?: string | null; id: string }) {
  return r.displayName?.trim() || r.email || r.id.slice(0, 8);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function PushPanel() {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const [filter, setFilter] = useState("");
  const [debounced, setDebounced] = useState("");
  const [remindersOnly, setRemindersOnly] = useState(true);
  // Selection survives filter changes: keep the full row so device counts
  // still add up for users the current filter hides.
  const [selected, setSelected] = useState<Map<string, AdminPushRecipient>>(new Map());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<AdminPushSendResponse | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(filter.trim()), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filter]);

  const query = useQuery({
    queryKey: queryKeys.admin.pushRecipients(debounced, remindersOnly),
    queryFn: () => fetchAdminPushRecipients(token, debounced, remindersOnly),
    enabled: Boolean(user?.isAdmin && token),
    placeholderData: keepPreviousData,
  });
  const shown = query.data?.recipients ?? [];
  const shownIds = useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  const hiddenSelected = [...selected.keys()].filter((id) => !shownIds.has(id)).length;
  const deviceCount = [...selected.values()].reduce((n, r) => n + r.tokenCount, 0);

  const toggle = (r: AdminPushRecipient, next: boolean) =>
    setSelected((prev) => {
      const copy = new Map(prev);
      if (next) copy.set(r.id, r);
      else copy.delete(r.id);
      return copy;
    });
  const selectAllShown = () =>
    setSelected((prev) => {
      const copy = new Map(prev);
      for (const r of shown) copy.set(r.id, r);
      return copy;
    });

  const trimmedUrl = url.trim();
  const urlProblem =
    trimmedUrl && !trimmedUrl.startsWith(URL_PREFIX) ? `Must start with ${URL_PREFIX}` : null;
  const canSend =
    selected.size > 0 && title.trim().length > 0 && body.trim().length > 0 && !urlProblem;

  const send = useMutation({
    mutationFn: () =>
      sendAdminPush(token, {
        userIds: [...selected.keys()],
        title: title.trim(),
        body: body.trim(),
        url: trimmedUrl || DEFAULT_URL,
        confirm: CONFIRM_WORD,
      }),
    onSuccess: (res) => {
      setResult(res);
      setConfirmOpen(false);
      setConfirmText("");
      // Dead tokens were pruned; refresh device counts.
      void queryClient.invalidateQueries({ queryKey: ["admin", "pushRecipients"] });
      showToast({
        message: `Sent to ${plural(res.sent, "device")}${res.failed ? ` · ${res.failed} failed` : ""}`,
        tone: res.failed ? "danger" : "success",
      });
    },
  });

  const recipientsCard = (
    <Card style={[styles.panel, wide && styles.half]} testID="admin-push-recipients">
      <View style={styles.headerRow}>
        <Text variant="label">Recipients</Text>
        <Text variant="caption" tone="muted">
          Everyone with a registered device. This reaches users regardless of their play-reminder
          setting unless “Reminders on only” is ticked.
        </Text>
      </View>
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Filter by name or email"
        placeholderTextColor={tokens.text.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        testID="push-filter"
      />
      <View style={styles.controls}>
        <Checkbox
          checked={remindersOnly}
          onChange={setRemindersOnly}
          label="Reminders on only"
          testID="push-reminders-only"
        />
        <View style={styles.flex} />
        <Button
          label="Select all shown"
          variant="ghost"
          onPress={selectAllShown}
          disabled={shown.length === 0}
          testID="push-select-all"
        />
        <Button
          label="Clear"
          variant="ghost"
          onPress={() => setSelected(new Map())}
          disabled={selected.size === 0}
          testID="push-clear"
        />
      </View>
      <Text variant="caption" tone="secondary" testID="push-count">
        {query.data
          ? `${plural(query.data.total, "user")} with push enabled${remindersOnly ? " and reminders on" : ""}${query.data.total > shown.length ? ` · showing ${shown.length}` : ""}`
          : query.isLoading
            ? "Loading…"
            : ""}
        {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        {hiddenSelected > 0 ? ` (+${hiddenSelected} selected not shown)` : ""}
      </Text>
      {query.isError ? (
        <View style={styles.controls}>
          <Text variant="caption" tone="danger" style={styles.flex}>
            {errorMessage(query.error, "Couldn't load recipients.")}
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : null}
      <View style={styles.list} testID="push-list">
        {shown.map((r) => (
          <RecipientRow
            key={r.id}
            recipient={r}
            checked={selected.has(r.id)}
            onChange={(next) => toggle(r, next)}
          />
        ))}
        {query.data && shown.length === 0 ? (
          <Text variant="caption" tone="muted" style={styles.empty}>
            No users match.
          </Text>
        ) : null}
      </View>
    </Card>
  );

  const composeCard = (
    <Card style={[styles.panel, wide && styles.half]} testID="admin-push-compose">
      <View style={styles.headerRow}>
        <Text variant="label">Message</Text>
        <Text variant="caption" tone="muted">
          Operator only, by hand. Goes to every device of each selected user.
        </Text>
      </View>
      <Field label="Title" count={title.length} max={ADMIN_PUSH_TITLE_MAX}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={ADMIN_PUSH_TITLE_MAX}
          placeholder="e.g. New game on HighScore"
          placeholderTextColor={tokens.text.secondary}
          style={styles.input}
          testID="push-title"
        />
      </Field>
      <Field label="Body" count={body.length} max={ADMIN_PUSH_BODY_MAX}>
        <TextInput
          value={body}
          onChangeText={setBody}
          maxLength={ADMIN_PUSH_BODY_MAX}
          multiline
          placeholder="What should they know?"
          placeholderTextColor={tokens.text.secondary}
          style={[styles.input, styles.multiline]}
          testID="push-body"
        />
      </Field>
      <Field label="Deep link (opened on tap)">
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={DEFAULT_URL}
          placeholderTextColor={tokens.text.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID="push-url"
        />
        {urlProblem ? (
          <Text variant="caption" tone="danger">
            {urlProblem}
          </Text>
        ) : null}
      </Field>
      <Text variant="overline" tone="muted">
        Preview
      </Text>
      <NotificationPreview title={title} body={body} />
      <Button
        label={
          selected.size > 0
            ? `Send to ${plural(selected.size, "user")} (${plural(deviceCount, "device")})`
            : "Send"
        }
        disabled={!canSend}
        onPress={() => {
          send.reset();
          setConfirmText("");
          setConfirmOpen(true);
        }}
        testID="push-send"
      />
      {result ? <SendResult result={result} /> : null}
    </Card>
  );

  return (
    <View testID="admin-push">
      <View style={[styles.layout, wide && styles.layoutWide]}>
        {recipientsCard}
        {composeCard}
      </View>
      <Sheet
        visible={confirmOpen}
        onRequestClose={() => (send.isPending ? undefined : setConfirmOpen(false))}
        testID="push-confirm-sheet"
      >
        <View style={styles.sheetBody}>
          <Text variant="heading">
            Send to {plural(selected.size, "user")} ({plural(deviceCount, "device")})?
          </Text>
          <NotificationPreview title={title.trim()} body={body.trim()} />
          <Text variant="caption" tone="secondary">
            Opens {trimmedUrl || DEFAULT_URL}. This can't be unsent.
          </Text>
          <Text variant="caption" tone="secondary">
            Type {CONFIRM_WORD} to confirm
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={tokens.text.secondary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            testID="push-confirm-input"
          />
          {send.isError ? (
            <Text variant="caption" tone="danger" testID="push-send-error">
              {errorMessage(send.error, "Couldn't send.")}
            </Text>
          ) : null}
          <View style={styles.controls}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setConfirmOpen(false)}
              disabled={send.isPending}
              style={styles.flex}
              testID="push-confirm-cancel"
            />
            <Button
              label="Send now"
              variant="danger"
              disabled={confirmText.trim() !== CONFIRM_WORD || send.isPending}
              loading={send.isPending}
              onPress={() => send.mutate()}
              style={styles.flex}
              testID="push-confirm-send"
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

function RecipientRow({
  recipient: r,
  checked,
  onChange,
}: {
  recipient: AdminPushRecipient;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.row, checked && styles.rowChecked]}>
      <Checkbox
        checked={checked}
        onChange={onChange}
        accessibilityLabel={`Select ${recipientName(r)}`}
        testID={`push-row-${r.id}`}
      />
      <View style={styles.rowText}>
        <Text variant="label" numberOfLines={1}>
          {recipientName(r)}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {r.platforms.join(", ")} · {plural(r.tokenCount, "device")} · seen{" "}
          {formatRelative(r.lastSeenAt)}
        </Text>
      </View>
      <Text variant="caption" tone={r.playReminderEnabled ? "success" : "muted"}>
        {r.playReminderEnabled ? "Reminder on" : "Reminder off"}
      </Text>
    </View>
  );
}

function Field({
  label,
  count,
  max,
  children,
}: {
  label: string;
  count?: number;
  max?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabel}>
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        {max !== undefined && count !== undefined ? (
          <Text variant="caption" tone={count >= max ? "danger" : "muted"}>
            {count}/{max}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A mock of the iOS lock-screen banner, so the operator sees the truncation. */
function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.preview} testID="push-preview">
      <View style={styles.previewIcon}>
        <Text style={styles.previewIconText}>HS</Text>
      </View>
      <View style={styles.previewText}>
        <View style={styles.previewHeader}>
          <Text style={styles.previewApp}>HIGHSCORE</Text>
          <Text style={styles.previewTime}>now</Text>
        </View>
        <Text style={styles.previewTitle} numberOfLines={1}>
          {title || "Title"}
        </Text>
        <Text style={styles.previewBody} numberOfLines={4}>
          {body || "Body"}
        </Text>
      </View>
    </View>
  );
}

function SendResult({ result }: { result: AdminPushSendResponse }) {
  const problems = result.perUser.filter((u: AdminPushUserResult) => u.status !== "sent");
  return (
    <View style={styles.result} testID="push-result">
      <Text variant="label">
        Sent {result.sent} · Failed {result.failed} · Pruned {result.pruned}
      </Text>
      <Text variant="caption" tone="secondary">
        {plural(result.recipients, "user")}, {plural(result.tokens, "device")}.
      </Text>
      {problems.map((u) => (
        <Text key={u.userId} variant="caption" tone="danger">
          {u.displayName ?? u.userId.slice(0, 8)}: {u.status.replace("_", " ")}
          {u.errors.length ? ` (${u.errors.join(", ")})` : ""}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: tokens.space.md },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  half: { flex: 1, minWidth: 0 },
  panel: { gap: tokens.space.md },
  headerRow: { gap: 2 },
  controls: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" },
  flex: { flex: 1 },
  list: { gap: 2 },
  empty: { paddingVertical: tokens.space.md, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  rowChecked: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  field: { gap: 4 },
  fieldLabel: { flexDirection: "row", justifyContent: "space-between" },
  input: {
    ...bodyType(),
    minHeight: 44,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.md,
    backgroundColor: tokens.bg.elevated,
    color: tokens.text.primary,
    // ≥16px: iOS Safari zooms on smaller focused inputs (root CLAUDE.md).
    fontSize: tokens.font.size.md,
  },
  multiline: { minHeight: 96, paddingVertical: tokens.space.sm, textAlignVertical: "top" },
  // iOS banner mock: deliberately OS-shaped (rounded, frosted grey), not
  // HighScore chrome — it previews what the phone draws.
  preview: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(235,235,245,0.16)",
  },
  previewIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: tokens.bg.canvas,
    borderWidth: 1,
    borderColor: tokens.neon.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  previewIconText: { ...bodyType("bold"), fontSize: 13, color: tokens.neon.pink },
  previewText: { flex: 1, minWidth: 0 },
  previewHeader: { flexDirection: "row", justifyContent: "space-between" },
  previewApp: { ...bodyType("medium"), fontSize: 12, color: tokens.text.secondary },
  previewTime: { ...bodyType(), fontSize: 12, color: tokens.text.secondary },
  previewTitle: { ...bodyType("semibold"), fontSize: 15, color: tokens.text.primary },
  previewBody: { ...bodyType(), fontSize: 15, lineHeight: 20, color: tokens.text.primary },
  result: {
    gap: 4,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
  },
  sheetBody: { gap: tokens.space.md },
});
