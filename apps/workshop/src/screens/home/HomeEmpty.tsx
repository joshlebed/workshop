import { getTemplate, type ListTemplate, templateListName } from "@workshop/shared/templates";
import {
  Button,
  EmojiBadge,
  homeLayout,
  type ListColorKey,
  ListRow,
  SectionHeader,
  Text,
  tokens,
} from "@workshop/ui";
import { ActivityIndicator, StyleSheet, View } from "react-native";

/**
 * The starters on an empty home (4.2), most common first. Each makes a
 * ready list in one tap; "Start from scratch" is the blank template.
 */
export const HOME_STARTER_IDS = ["movie_watchlist", "date_ideas", "shared_todo"] as const;

const STARTER_SUBTITLE: Record<string, string> = {
  movie_watchlist: "Films you mean to see, checked off as you go",
  date_ideas: "Places and links for a free evening",
  shared_todo: "A checklist anyone on it can tick off",
  blank_list: "Name it and add whatever you like",
};

function starters(): ListTemplate[] {
  return HOME_STARTER_IDS.map((id) => getTemplate(id)).filter((t): t is ListTemplate => !!t);
}

/**
 * Home with nothing on it. Brand new: one sentence on what a list is here,
 * then starters (the only create affordance; there is no FAB while empty).
 * Every list hidden: says so and links to them.
 */
export function HomeEmpty({
  hiddenCount,
  pendingTemplateId,
  onCreate,
  onMoreTemplates,
  onOpenHidden,
}: {
  hiddenCount: number;
  pendingTemplateId: string | null;
  onCreate: (template: ListTemplate) => void;
  onMoreTemplates: () => void;
  onOpenHidden: () => void;
}) {
  if (hiddenCount > 0) {
    return (
      <View style={styles.root} testID="home-all-hidden">
        <Text tone="secondary" style={styles.lead}>
          Every list you have is hidden from home.
        </Text>
        <ListRow
          title={`${hiddenCount} hidden ${hiddenCount === 1 ? "list" : "lists"}`}
          subtitle="Unhide one to bring it back here"
          chevron
          onPress={onOpenHidden}
          testID="home-hidden-link"
        />
        <View style={styles.more}>
          <Button
            label="New list"
            variant="ghost"
            onPress={onMoreTemplates}
            style={styles.flush}
            testID="home-new-list"
          />
        </View>
      </View>
    );
  }

  const blank = getTemplate("blank_list");
  const busy = pendingTemplateId !== null;
  const row = (t: ListTemplate, title: string, testID: string) => (
    <ListRow
      key={t.id}
      title={title}
      subtitle={STARTER_SUBTITLE[t.id] ?? t.description}
      leading={
        <EmojiBadge
          emoji={t.defaults.emoji}
          color={tokens.list[t.defaults.color as ListColorKey]}
        />
      }
      trailing={
        pendingTemplateId === t.id ? <ActivityIndicator color={tokens.text.muted} /> : undefined
      }
      disabled={busy}
      onPress={() => onCreate(t)}
      accessibilityLabel={title}
      accessibilityHint="Makes the list and opens it"
      testID={testID}
    />
  );

  return (
    <View style={styles.root} testID="home-empty">
      <Text tone="secondary" style={styles.lead}>
        A list is one place for the films, plans or errands you're keeping, and everyone you share
        it with can add to it.
      </Text>
      <SectionHeader title="Start with" style={styles.header} />
      {starters().map((t) => row(t, templateListName(t), `home-starter-${t.id}`))}
      {blank ? row(blank, "Start from scratch", "home-starter-blank_list") : null}
      <View style={styles.more}>
        <Button
          label="More templates"
          variant="ghost"
          onPress={onMoreTemplates}
          disabled={busy}
          style={styles.flush}
          testID="home-more-templates"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A ghost button's label lines up with the row titles' left edge.
  flush: { marginLeft: -(tokens.space.lg + 1) },
  root: { paddingTop: homeLayout.contentTopGap, paddingBottom: homeLayout.bottomInset },
  lead: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: tokens.space.lg,
  },
  header: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingBottom: tokens.space.xs,
  },
  more: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.md,
    alignItems: "flex-start",
  },
});
