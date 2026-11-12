// "Synced from" in list settings: the sources a list of this kind can pull
// rows from (`listKind(itemKind).syncSources`), with Sync now, Remove and a
// Connect form when nothing is attached. Rendered only for kinds that have a
// sync source; the `sources` feature itself is derived on the server from
// what is attached here, so there is no switch for it.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ItemKind, ListSource } from "@workshop/shared";
import {
  LETTERBOXD_MATCH_SOURCE_KIND,
  listKind,
  SYNC_SOURCE_COPY,
  sourceDisplayName,
} from "@workshop/shared/listKinds";
import {
  Button,
  confirm,
  formatRelative,
  haptics,
  IconButton,
  ListRow,
  layout,
  SectionHeader,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { createSource, deleteSource, syncSource } from "../../api/sources";
import { FAILURE_TOAST_KEY, failureMessage } from "../../lib/errorCopy";
import { sourceErrorMessage } from "../../lib/sourceErrors";

interface Props {
  listId: string;
  itemKind: ItemKind | null;
  sources: ListSource[];
  isOwner: boolean;
  token: string | null;
}

function countToast(n: number, one: string, many: string): string {
  return n === 0 ? "Nothing new" : `${n} new ${n === 1 ? one : many}`;
}

export function SyncedFrom({ listId, itemKind, sources, isOwner, token }: Props) {
  const kind = listKind(itemKind);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [url, setUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  // The Letterboxd-match source belongs to its feature switch, not here.
  const attached = sources.filter((s) => s.kind !== LETTERBOXD_MATCH_SOURCE_KIND);
  const connectKind = kind.syncSources.find((k) => !attached.some((s) => s.kind === k));
  const connectCopy = connectKind ? SYNC_SOURCE_COPY[connectKind] : null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(listId) }),
    ]);

  const syncMutation = useMutation({
    mutationFn: (sourceId: string) => syncSource(listId, sourceId, token),
    onSuccess: async (res) => {
      await refresh();
      showToast({
        message: countToast(res.addedCount, kind.noun.one, kind.noun.many),
        tone: res.addedCount === 0 ? "default" : "success",
      });
    },
    onError: (e, sourceId) => {
      showToast({
        message: sourceErrorMessage(e, "Couldn't sync."),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => syncMutation.mutate(sourceId),
      });
    },
  });

  const connectMutation = useMutation({
    mutationFn: () => {
      if (!connectKind || !connectCopy) throw new Error("nothing to connect");
      return createSource(
        listId,
        { kind: connectKind, config: { [connectCopy.configKey]: url.trim() } },
        token,
      );
    },
    // A create: `success`, on the tap.
    onMutate: () => {
      haptics.success();
      setFieldError(null);
    },
    onSuccess: async (res) => {
      setUrl("");
      await refresh();
      showToast({
        message: `Connected. ${countToast(res.addedCount ?? 0, kind.noun.one, kind.noun.many)}.`,
        tone: "success",
      });
    },
    onError: (e) => {
      // The field says what's wrong with the link it holds (0.x error rule).
      setFieldError(sourceErrorMessage(e, "Couldn't connect that link.", "creation"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (sourceId: string) => deleteSource(listId, sourceId, token),
    onSuccess: async () => {
      await refresh();
      showToast({ message: "Stopped syncing" });
    },
    onError: (e) => {
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't stop syncing."),
        tone: "danger",
      });
    },
  });

  const onRemove = async (source: ListSource) => {
    const name = sourceDisplayName(source.kind);
    const ok = await confirm({
      title: `Stop syncing from this ${name}?`,
      message: `${kind.noun.many.charAt(0).toUpperCase()}${kind.noun.many.slice(1)} already here stay on the list. You can connect it again later.`,
      confirmLabel: "Stop syncing",
      destructive: true,
    });
    if (!ok) return;
    haptics.warning();
    removeMutation.mutate(source.id);
  };

  // Members see what the list syncs from (and can sync it); only the owner
  // connects or removes. Nothing to show a member when nothing is attached.
  if (kind.syncSources.length === 0 || (!isOwner && attached.length === 0)) return null;

  const canConnect = url.trim().length > 0 && !connectMutation.isPending;

  return (
    <View testID="settings-synced-from">
      <SectionHeader title="Synced from" />
      {attached.map((src) => {
        const busy = syncMutation.isPending && syncMutation.variables === src.id;
        return (
          <ListRow
            key={src.id}
            title={sourceDisplayName(src.kind)}
            subtitle={
              busy
                ? "Syncing…"
                : src.lastSyncedAt
                  ? `Synced ${formatRelative(src.lastSyncedAt)}`
                  : "Not synced yet"
            }
            trailing={
              <View style={styles.rowActions}>
                <Button
                  label="Sync now"
                  variant="secondary"
                  loading={busy}
                  disabled={busy}
                  onPress={() => syncMutation.mutate(src.id)}
                  testID={`settings-source-${src.id}-sync`}
                />
                {isOwner ? (
                  <IconButton
                    icon="trash"
                    iconTone="secondary"
                    accessibilityLabel={`Stop syncing from ${sourceDisplayName(src.kind)}`}
                    disabled={removeMutation.isPending}
                    onPress={() => void onRemove(src)}
                    testID={`settings-source-${src.id}-remove`}
                  />
                ) : null}
              </View>
            }
            testID={`settings-source-${src.id}`}
          />
        );
      })}
      {isOwner && connectKind && connectCopy && attached.length === 0 ? (
        <View style={styles.connect} testID={`settings-connect-${connectKind}`}>
          <TextField
            label={connectCopy.connect}
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              if (fieldError) setFieldError(null);
            }}
            placeholder={connectCopy.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => {
              if (canConnect) connectMutation.mutate();
            }}
            error={fieldError ?? undefined}
            testID="settings-connect-url"
          />
          <Text variant="caption" tone="muted">
            {connectCopy.help}
          </Text>
          <View style={styles.connectRow}>
            <Button
              label="Connect"
              loading={connectMutation.isPending}
              disabled={!canConnect}
              onPress={() => connectMutation.mutate()}
              testID="settings-connect-submit"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowActions: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  connect: { gap: tokens.space.sm, paddingHorizontal: layout.gutter },
  connectRow: { flexDirection: "row" },
});
