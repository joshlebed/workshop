// Workshop's admin analytics dashboard: active users and the product's core
// daily activity, served by `GET /v1/admin/analytics?client=workshop`. The
// server is the gate (403 for non-admins); `user.isAdmin` only decides
// whether to render the dashboard or the "admins only" note.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AdminAnalyticsResponse } from "@workshop/shared";
import {
  ADMIN_ANALYTICS_RANGES,
  type AdminAnalyticsPlatform,
  type AdminAnalyticsRange,
} from "@workshop/shared/constants";
import {
  BarChart,
  Button,
  Card,
  Chip,
  HorizontalBars,
  IconButton,
  Screen,
  Text,
  tokens,
} from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { fetchAdminAnalytics } from "../api/admin";
import { useAuth } from "../hooks/useAuth";

const CLIENT = "workshop" as const;

// Fixed platform hues, validated for the dark surface (CVD-safe, ≥3:1).
const PLATFORM_COLORS: Record<AdminAnalyticsPlatform, string> = {
  ios: "#c98500",
  web: "#3987e5",
  other: "#199e70",
};

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function AdminAnalytics() {
  const { user, token } = useAuth();
  const [range, setRange] = useState<AdminAnalyticsRange>(30);
  const isAdmin = Boolean(user?.isAdmin);

  const query = useQuery<AdminAnalyticsResponse>({
    queryKey: queryKeys.admin.analytics(CLIENT, range),
    queryFn: () => fetchAdminAnalytics(token, CLIENT, range),
    enabled: isAdmin && Boolean(token),
    staleTime: 60_000,
  });

  return (
    <Screen style={styles.root} testID="admin-analytics">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="caption" tone="muted" style={styles.headerEyebrow}>
            Admin
          </Text>
          <Text variant="heading" numberOfLines={1}>
            Workshop analytics
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Close analytics"
          onPress={() => goBack("/")}
          testID="admin-analytics-close"
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </IconButton>
      </View>

      {!isAdmin ? (
        <View style={styles.body}>
          <Card>
            <Text variant="heading">Admins only</Text>
            <Text tone="secondary" style={styles.gap}>
              This dashboard is only available to Workshop admins.
            </Text>
          </Card>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.rangeRow} testID="admin-analytics-range">
            {ADMIN_ANALYTICS_RANGES.map((days) => (
              <Chip
                key={days}
                label={days === 365 ? "1 year" : `${days} days`}
                selected={range === days}
                onPress={() => setRange(days)}
                testID={`admin-analytics-range-${days}`}
              />
            ))}
          </View>

          {query.isError ? (
            <Card>
              <Text tone="danger">{errorMessage(query.error)}</Text>
              <Button
                label="Retry"
                variant="secondary"
                onPress={() => void query.refetch()}
                style={styles.gap}
              />
            </Card>
          ) : null}

          {query.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={tokens.accent.default} />
            </View>
          ) : null}

          {query.data ? (
            <>
              <View style={styles.statGrid} testID="admin-analytics-stats">
                {query.data.stats.map((stat) => (
                  <Card key={stat.key} style={styles.statTile} testID={`stat-${stat.key}`}>
                    <Text variant="caption" tone="muted">
                      {stat.label}
                    </Text>
                    <Text style={styles.statValue}>{stat.value.toLocaleString()}</Text>
                  </Card>
                ))}
              </View>

              {query.data.series.map((series) => (
                <Card key={series.key} style={styles.chartCard} testID={`series-${series.key}`}>
                  <Text variant="label">{series.label}</Text>
                  <View style={styles.chart}>
                    <BarChart
                      points={series.points}
                      bucket={query.data.bucket}
                      stack={series.stack?.map((seg) => ({
                        ...seg,
                        color: PLATFORM_COLORS[seg.key],
                      }))}
                      stackMode={series.stackMode}
                    />
                  </View>
                  <Text variant="caption" tone="muted">
                    {series.description}
                  </Text>
                </Card>
              ))}

              {(query.data.breakdowns ?? []).map((b) => (
                <Card key={b.key} style={styles.chartCard} testID={`breakdown-${b.key}`}>
                  <Text variant="label">{b.label}</Text>
                  <HorizontalBars
                    rows={b.rows.map((r) => ({
                      label: r.label,
                      value: r.value,
                      color: PLATFORM_COLORS[r.platform],
                    }))}
                  />
                  <Text variant="caption" tone="muted">
                    {b.description}
                  </Text>
                </Card>
              ))}

              <Text variant="caption" tone="muted" style={styles.footer}>
                UTC {query.data.bucket === "week" ? "weeks" : "days"} · computed{" "}
                {formatGeneratedAt(query.data.generatedAt)}
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.md,
    gap: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  headerEyebrow: { letterSpacing: 0.4, textTransform: "uppercase" },
  closeGlyph: { fontSize: 18, color: tokens.text.secondary },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
  rangeRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  loading: { paddingVertical: tokens.space.xl, alignItems: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  statTile: { flexGrow: 1, flexBasis: "30%", gap: 2 },
  statValue: {
    fontSize: tokens.font.size.xxl,
    lineHeight: 34,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.primary,
  },
  chartCard: { gap: tokens.space.sm },
  chart: { paddingTop: tokens.space.md },
  gap: { marginTop: tokens.space.sm },
  footer: { textAlign: "center", marginTop: tokens.space.sm },
});
