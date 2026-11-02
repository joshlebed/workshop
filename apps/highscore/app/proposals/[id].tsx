import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ProposalA } from "../../src/proposals/ProposalA";
import { ProposalB } from "../../src/proposals/ProposalB";
import { ProposalC } from "../../src/proposals/ProposalC";
import { PROPOSALS } from "../../src/proposals/report";
import { useProfileData } from "../../src/proposals/shared";
import { Text, tokens } from "../../src/theme";

export default function ProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useProfileData();
  const proposal = PROPOSALS.find((p) => p.id === id) ?? PROPOSALS[0];
  if (!proposal) return null;
  return (
    <ScrollView contentContainerStyle={styles.body} testID={`proposal-screen-${proposal.id}`}>
      <View style={styles.switcher}>
        {PROPOSALS.map((p) => {
          const active = p.id === proposal.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => router.replace(`/proposals/${p.id}` as Href)}
              style={[styles.tab, active && styles.tabActive]}
              testID={`switch-${p.id}`}
            >
              <Text variant="label" tone={active ? "link" : "secondary"}>
                {p.id.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="title">{proposal.name}</Text>
      <Text tone="secondary">{proposal.tagline}</Text>

      {proposal.id === "a" ? (
        <ProposalA data={data} />
      ) : proposal.id === "b" ? (
        <ProposalB data={data} />
      ) : (
        <ProposalC data={data} />
      )}

      <Section title="What it is">
        <Text>{proposal.summary}</Text>
      </Section>
      <Section title="Prior art">
        {proposal.priorArt.map((t) => (
          <Bullet key={t}>{t}</Bullet>
        ))}
      </Section>
      <Section title="Design principles">
        {proposal.principles.map((t) => (
          <Bullet key={t}>{t}</Bullet>
        ))}
      </Section>
      <Section title="Trade-offs">
        {proposal.tradeoffs.map((t) => (
          <Bullet key={t}>{t}</Bullet>
        ))}
      </Section>
      <Section title="Pick this when">
        <Text>{proposal.bestWhen}</Text>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="overline" tone="secondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bullet}>
      <Text tone="link">·</Text>
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: tokens.space.lg,
    gap: tokens.space.md,
    paddingBottom: tokens.space.xxl * 2,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
  },
  switcher: { flexDirection: "row", gap: tokens.space.sm },
  tab: {
    paddingHorizontal: tokens.space.lg,
    height: 36,
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  tabActive: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  section: { gap: tokens.space.sm, paddingTop: tokens.space.sm },
  bullet: { flexDirection: "row", gap: tokens.space.sm },
});
