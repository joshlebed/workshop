import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { List, ListDetailResponse, ListListResponse, ShareVisibility } from "@workshop/shared";
import {
  Button,
  confirm,
  EmojiBadge,
  Icon,
  type ListColorKey,
  RadioRow,
  Sheet,
  Text,
  tokens,
  useToast,
} from "@workshop/ui";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { resetListShareSlug, SHARE_VISIBILITY_LABELS, updateListShare } from "../api/share";
import { useAuth } from "../hooks/useAuth";
import { buildListShareUrl, shareOrCopyLink } from "../lib/share";

export type ShareableList = Pick<
  List,
  "id" | "name" | "emoji" | "color" | "coverPhotoUrl" | "ownerId" | "shareSlug" | "shareVisibility"
>;

const VISIBILITY_ORDER: readonly ShareVisibility[] = ["join", "view", "off"];

/**
 * The one share sheet (UX pass 3.3), opened from the list header's share
 * button, the home row menu and list settings. Owners pick who the link lets
 * in (saves on tap, optimistic) and can reset it; everyone can send the link
 * while it is on. "Share link" opens the system share sheet on native and in
 * browsers with Web Share, and copies otherwise.
 */
export function ShareListSheet({
  list,
  visible,
  onClose,
}: {
  list: ShareableList | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isOwner = !!list && !!user && list.ownerId === user.id;

  // Local copies so a tap answers at once; reseeded whenever the sheet opens
  // for a list (or the server's value moves while it is closed).
  const [visibility, setVisibility] = useState<ShareVisibility>(list?.shareVisibility ?? "off");
  const [slug, setSlug] = useState(list?.shareSlug ?? "");
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!list) return;
    if (!visible) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === list.id) return;
    seededFor.current = list.id;
    setVisibility(list.shareVisibility);
    setSlug(list.shareSlug);
  }, [list, visible]);

  // A toast fired while the sheet's Modal is still up renders behind it on
  // web; queue it for `onClosed`.
  const afterClose = useRef<(() => void) | null>(null);
  const closeThen = (action: () => void) => {
    afterClose.current = action;
    onClose();
  };

  const patchCaches = (listId: string, patch: Partial<List>) => {
    queryClient.setQueryData<ListDetailResponse>(queryKeys.lists.detail(listId), (d) =>
      d ? { ...d, list: { ...d.list, ...patch } } : d,
    );
    queryClient.setQueryData<ListListResponse>(queryKeys.lists.all, (d) =>
      d ? { lists: d.lists.map((l) => (l.id === listId ? { ...l, ...patch } : l)) } : d,
    );
  };
  const refresh = (listId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
  };

  const visibilityMutation = useMutation({
    mutationFn: ({
      listId,
      next,
    }: {
      listId: string;
      next: ShareVisibility;
      prev: ShareVisibility;
    }) => updateListShare(listId, { visibility: next }, token),
    onMutate: ({ listId, next }) => {
      setVisibility(next);
      patchCaches(listId, { shareVisibility: next });
    },
    onError: (e, { listId, prev }) => {
      setVisibility(prev);
      patchCaches(listId, { shareVisibility: prev });
      showToast({ message: errorMessage(e, "Couldn't change sharing."), tone: "danger" });
    },
    onSettled: (_r, _e, { listId }) => refresh(listId),
  });

  const resetMutation = useMutation({
    mutationFn: (listId: string) => resetListShareSlug(listId, token),
    onSuccess: (res, listId) => {
      setSlug(res.shareSlug);
      patchCaches(listId, { shareSlug: res.shareSlug });
      refresh(listId);
      showToast({ message: "New link made. The old one no longer works.", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't reset the link."), tone: "danger" });
    },
  });

  const onShare = async () => {
    if (!list) return;
    const result = await shareOrCopyLink(buildListShareUrl(slug), {
      webShare: true,
      title: list.name,
    });
    if (result === "copied")
      closeThen(() => showToast({ message: "Link copied", tone: "success" }));
    else if (result === "failed") showToast({ message: "Couldn't copy the link.", tone: "danger" });
    else if (result === "shared") onClose();
  };

  const onReset = async () => {
    if (!list) return;
    const ok = await confirm({
      title: `Reset the link for “${list.name}”?`,
      message: "The current link stops working everywhere it was sent. Members keep access.",
      confirmLabel: "Reset link",
      destructive: true,
    });
    if (ok) resetMutation.mutate(list.id);
  };

  const accent = list
    ? (tokens.list[list.color as ListColorKey] ?? tokens.accent.default)
    : tokens.accent.default;
  const linkOn = visibility !== "off";
  const displayUrl = slug ? buildListShareUrl(slug).replace(/^https?:\/\//, "") : "";

  return (
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      onClosed={() => {
        const action = afterClose.current;
        afterClose.current = null;
        action?.();
      }}
      testID="share-sheet"
    >
      {list ? (
        <View style={styles.body}>
          <View style={styles.header}>
            <EmojiBadge emoji={list.emoji} color={accent} imageUrl={list.coverPhotoUrl} />
            <View style={styles.headerText}>
              <Text variant="heading" numberOfLines={1}>
                Share {list.name}
              </Text>
              {linkOn ? (
                <Text
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  selectable
                  testID="share-sheet-url"
                >
                  {displayUrl}
                </Text>
              ) : null}
            </View>
          </View>

          {isOwner ? (
            <View role="radiogroup" aria-label="Who the link lets in" style={styles.options}>
              {VISIBILITY_ORDER.map((opt) => (
                <RadioRow
                  key={opt}
                  label={SHARE_VISIBILITY_LABELS[opt].title}
                  description={SHARE_VISIBILITY_LABELS[opt].help}
                  selected={visibility === opt}
                  onSelect={() => {
                    if (opt === visibility) return;
                    visibilityMutation.mutate({ listId: list.id, next: opt, prev: visibility });
                  }}
                  testID={`share-visibility-${opt}`}
                />
              ))}
            </View>
          ) : linkOn ? (
            <Text tone="secondary" style={styles.note}>
              {SHARE_VISIBILITY_LABELS[visibility].help}
            </Text>
          ) : (
            <Text tone="secondary" style={styles.note} testID="share-sheet-owner-only">
              Sharing is off. Only the owner can turn it on.
            </Text>
          )}

          {linkOn ? (
            <Button
              label="Share link"
              size="lg"
              leftIcon={<Icon name="share" size={18} tone="onAccent" />}
              onPress={() => void onShare()}
              testID="share-sheet-share"
            />
          ) : null}
          {isOwner ? (
            <Button
              label="Reset link"
              variant="ghost"
              loading={resetMutation.isPending}
              disabled={resetMutation.isPending}
              onPress={() => void onReset()}
              testID="share-sheet-reset"
            />
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: tokens.space.lg },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  headerText: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  options: { gap: tokens.space.xs },
  note: { paddingHorizontal: tokens.space.xxs },
});
