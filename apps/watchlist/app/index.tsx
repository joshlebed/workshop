import type { WatchlistItem } from "@workshop/shared";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "../src/api/client";
import { useAuth } from "../src/hooks/useAuth";

export default function Home() {
  const { signOut } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listWatchlist();
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function toggleWatched(item: WatchlistItem) {
    const next = item.status === "watched" ? "want_to_watch" : "watched";
    try {
      const updated = await api.updateItem(item.id, { status: next });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
            <Text style={styles.emptyBody}>Tap + to add your first movie.</Text>
          </View>
        }
        ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => toggleWatched(item)}>
            <View style={styles.rowText}>
              <Text style={styles.title}>{item.title}</Text>
              {item.year ? <Text style={styles.meta}>{item.year}</Text> : null}
            </View>
            <View
              style={[
                styles.status,
                item.status === "watched" && styles.statusWatched,
                item.status === "abandoned" && styles.statusAbandoned,
              ]}
            >
              <Text style={styles.statusText}>
                {item.status === "watched"
                  ? "watched"
                  : item.status === "abandoned"
                    ? "skipped"
                    : "to watch"}
              </Text>
            </View>
          </Pressable>
        )}
      />

      <Link href="/add" asChild>
        <Pressable style={styles.fab}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </Link>

      <Pressable onPress={signOut} style={styles.signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { padding: 40, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  emptyBody: { color: "#666" },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
    flexDirection: "row",
    alignItems: "center",
  },
  rowText: { flex: 1 },
  title: { fontSize: 17, fontWeight: "500" },
  meta: { color: "#888", fontSize: 13, marginTop: 2 },
  status: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#eee",
  },
  statusWatched: { backgroundColor: "#dcfce7" },
  statusAbandoned: { backgroundColor: "#fee2e2" },
  statusText: { fontSize: 12, fontWeight: "600", color: "#444" },
  fab: {
    position: "absolute",
    bottom: 40,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { fontSize: 34, color: "#fff", fontWeight: "300", lineHeight: 36 },
  signOut: { position: "absolute", top: 8, right: 16, padding: 8 },
  signOutText: { color: "#888" },
  error: { color: "#b00", padding: 16 },
});
