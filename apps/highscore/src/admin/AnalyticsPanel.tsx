// The analytics tab of HighScore's admin dashboard: active users and the
// product's core daily activity, served by `GET /v1/admin/analytics?client=highscore`.
// The server is the gate (403 for non-admins); the dashboard only mounts this
// for `user.isAdmin`.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { AdminAnalyticsResponse } from "@workshop/shared";
import {
  ADMIN_ANALYTICS_RANGES,
  type AdminAnalyticsPlatform,
  type AdminAnalyticsRange,
} from "@workshop/shared/constants";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { fetchAdminAnalytics } from "../api/admin";
import { useAuth } from "../hooks/useAuth";
import {
  BarChart,
  Button,
  bodyType,
  Card,
  Chip,
  HorizontalBars,
  StackedAreaChart,
  Text,
  tokens,
} from "../theme";

const CLIENT = "highscore" as const;

// Fixed platform hues from the neon palette: pink / yellow / secondary grey
// stay distinguishable on the dark surface (and for CVD) without borrowing
// chartreuse, which is reserved for success.
const PLATFORM_COLORS: Record<AdminAnalyticsPlatform, string> = {
  ios: tokens.neon.pink,
  web: tokens.neon.yellow,
  other: tokens.text.secondary,
};

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** The analytics tab of the admin dashboard: range picker, stat tiles, series, breakdowns. */
export function AnalyticsPanel() {
  const { token } = useAuth();
  const [range, setRange] = useState<AdminAnalyticsRange>(30);
  const [versionMode, setVersionMode] = useState<"count" | "share">("count");

  const query = useQuery<AdminAnalyticsResponse>({
    queryKey: queryKeys.admin.analytics(CLIENT, range),
    queryFn: () => fetchAdminAnalytics(token, CLIENT, range),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  return (
    <View style={styles.body} testID="admin-analytics">
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
                  color: r.platform ? PLATFORM_COLORS[r.platform] : tokens.accent.default,
                }))}
              />
              <Text variant="caption" tone="muted">
                {b.description}
              </Text>
            </Card>
          ))}

          {query.data.versionAdoption ? (
            <Card style={styles.chartCard} testID="version-adoption">
              <View style={styles.cardHeader}>
                <Text variant="label">{query.data.versionAdoption.label}</Text>
                <View style={styles.rangeRow}>
                  <Chip
                    label="Users"
                    selected={versionMode === "count"}
                    onPress={() => setVersionMode("count")}
                    testID="version-adoption-mode-count"
                  />
                  <Chip
                    label="Share"
                    selected={versionMode === "share"}
                    onPress={() => setVersionMode("share")}
                    testID="version-adoption-mode-share"
                  />
                </View>
              </View>
              <StackedAreaChart
                segments={query.data.versionAdoption.segments}
                bucket={query.data.bucket}
                mode={versionMode}
              />
              <Text variant="caption" tone="muted">
                {query.data.versionAdoption.description}
              </Text>
            </Card>
          ) : null}

          <Text variant="caption" tone="muted" style={styles.footer}>
            UTC {query.data.bucket === "week" ? "weeks" : "days"} · computed{" "}
            {formatGeneratedAt(query.data.generatedAt)}
            {query.data.requestsThrough
              ? ` · API requests through ${formatGeneratedAt(query.data.requestsThrough)}`
              : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: tokens.space.md },
  rangeRow: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  loading: { paddingVertical: tokens.space.xl, alignItems: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  statTile: { flexGrow: 1, flexBasis: "30%", gap: 2 },
  statValue: {
    ...bodyType("semibold"),
    fontSize: tokens.font.size.xxl,
    lineHeight: 34,
    color: tokens.text.primary,
  },
  cardHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
  },
  chartCard: { gap: tokens.space.sm },
  chart: { paddingTop: tokens.space.md },
  gap: { marginTop: tokens.space.sm },
  footer: { textAlign: "center", marginTop: tokens.space.sm },
});
