// Ranked horizontal bars (label · bar · value) for small breakdowns such as
// "versions in use". Bars are proportional to the largest row; the value is
// a direct label in text tokens, the color only identifies the row's group.

import { StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { tokens as theme } from "./theme";

export interface HorizontalBarRow {
  label: string;
  value: number;
  color: string;
}

export interface HorizontalBarsProps {
  rows: HorizontalBarRow[];
  testID?: string;
}

export function HorizontalBars({ rows, testID }: HorizontalBarsProps) {
  const max = rows.reduce((acc, r) => Math.max(acc, r.value), 0);
  if (rows.length === 0) {
    return (
      <Text variant="caption" tone="muted" testID={testID}>
        No data yet.
      </Text>
    );
  }
  return (
    <View style={styles.root} testID={testID}>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.label}>
            {row.label}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: row.color,
                  width: `${max > 0 ? Math.max((row.value / max) * 100, 1) : 0}%`,
                },
              ]}
            />
          </View>
          <Text variant="label" style={styles.value}>
            {row.value.toLocaleString()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { width: 168 },
  track: { flex: 1, height: 12, borderRadius: 3, backgroundColor: theme.bg.elevated },
  bar: { height: "100%", borderRadius: 3 },
  value: { width: 40, textAlign: "right" },
});
