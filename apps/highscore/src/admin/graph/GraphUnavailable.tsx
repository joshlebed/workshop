// Native fallback for the three web-only graph canvases (d3 / sigma /
// cytoscape all need a DOM). Each `<View>.tsx` re-exports this so the iOS
// Metro bundle never pulls a DOM library in; the `.web.tsx` siblings hold the
// real renderers.

import { Card, Text, tokens } from "@workshop/ui";
import { StyleSheet } from "react-native";
import type { GraphViewProps } from "./model";

export function GraphUnavailable({ data, height }: GraphViewProps) {
  return (
    <Card style={[styles.card, { minHeight: Math.min(height, 240) }]}>
      <Text variant="label">Web only</Text>
      <Text tone="secondary" style={styles.gap}>
        The users web is drawn with browser-only libraries. Open highscore.live on a computer to
        explore it. {data.nodes.length} users · {data.edges.length} friendships.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { justifyContent: "center" },
  gap: { marginTop: tokens.space.sm },
});
