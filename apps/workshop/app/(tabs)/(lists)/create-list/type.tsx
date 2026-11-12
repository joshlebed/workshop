import { groupTemplates, type ListTemplate } from "@workshop/shared/templates";
import {
  EmojiBadge,
  type ListColorKey,
  ListRow,
  layout,
  Screen,
  ScreenHeader,
  SectionHeader,
  Switch,
  screenColumnStyle,
  Text,
  tokens,
} from "@workshop/ui";
import { type Href, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useCreateFromTemplate } from "../../../../src/hooks/useCreateFromTemplate";
import { goBack } from "../../../../src/lib/goBack";
import { normalizeSharePayload, shareAddParams } from "../../../../src/lib/sharePayload";
import { useEscapeToClose } from "../../../../src/lib/shortcuts/useShortcuts";

// Session memory: someone who customizes once likely wants to again.
let customizeFirstPreference = false;

/**
 * Create a list in one decision (UX pass 4.3). Tapping a template makes the
 * list at once with the template's name, emoji and color, and lands in it
 * with the add surface open; the name is editable in the list header.
 * Importers keep their one extra step (the playlist or list link). "Customize
 * first" is the quiet path to choosing the name and look up front.
 *
 * A share carried through "New list" in the share picker arrives as
 * `?url=&text=` and is prefilled on the new list's add surface (4.4).
 */
export default function CreateListType() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const share = useMemo(
    () => normalizeSharePayload({ url: first(params.url), text: first(params.text) }),
    [params.url, params.text],
  );
  const [customizeFirst, setCustomizeFirst] = useState(customizeFirstPreference);
  const { create, pendingTemplateId } = useCreateFromTemplate();
  const busy = pendingTemplateId !== null;

  const onPick = (template: ListTemplate) => {
    if (busy) return;
    const carried = share ? shareAddParams(share) : {};
    if (customizeFirst) {
      router.push({
        pathname: "/create-list/customize",
        params: { template: template.id, ...carried },
      } as Href);
      return;
    }
    if (template.requiresSource) {
      router.push({
        pathname: "/create-list/playlist",
        params: { template: template.id, step: "2", steps: "2" },
      } as Href);
      return;
    }
    create({ template, addParams: carried });
  };

  const isFocused = useIsFocused();
  useEscapeToClose(() => goBack("/"), isFocused);

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="close"
        onLeadingPress={() => goBack("/")}
        leadingLabel="Cancel"
        leadingTestID="create-list-cancel"
        title="New list"
      />

      <ScrollView contentContainerStyle={[styles.body, screenColumnStyle]}>
        <Text tone="secondary" style={styles.lead}>
          {share
            ? "Pick a kind of list. What you shared goes in first."
            : "Pick a kind of list. You can rename it and change anything later."}
        </Text>
        {groupTemplates().map((group) => (
          <View key={group.id}>
            <SectionHeader title={group.title} />
            {group.templates.map((tpl) => (
              <ListRow
                key={tpl.id}
                testID={`create-list-template-${tpl.id}`}
                accessibilityHint={
                  customizeFirst
                    ? "Choose a name and look next"
                    : tpl.requiresSource
                      ? "Paste a link next"
                      : "Makes the list now"
                }
                onPress={() => onPick(tpl)}
                disabled={busy}
                leading={
                  <EmojiBadge
                    emoji={tpl.defaults.emoji}
                    color={tokens.list[tpl.defaults.color as ListColorKey]}
                  />
                }
                title={tpl.displayName}
                subtitle={tpl.description}
                trailing={
                  pendingTemplateId === tpl.id ? (
                    <ActivityIndicator color={tokens.text.muted} accessibilityLabel="Creating" />
                  ) : undefined
                }
              />
            ))}
          </View>
        ))}
        <Switch
          value={customizeFirst}
          onValueChange={(next) => {
            customizeFirstPreference = next;
            setCustomizeFirst(next);
          }}
          label="Customize first"
          description="Choose the name, emoji and color before the list is made"
          testID="create-list-customize-first"
          style={styles.customize}
        />
      </ScrollView>
    </Screen>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingTop: layout.contentTopGap, paddingBottom: layout.bottomInset },
  lead: { paddingHorizontal: layout.gutter },
  // 4 margin + the tile's 12 padding puts its label on the gutter, like a row.
  customize: { marginTop: layout.sectionTop, marginHorizontal: tokens.space.xs },
});
