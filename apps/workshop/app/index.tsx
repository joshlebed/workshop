import type { RecCategory, RecItem } from "@workshop/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../src/api/client";
import { AddEditModal } from "../src/components/AddEditModal";
import { CategoryDropdown } from "../src/components/CategoryDropdown";
import { ContextMenu } from "../src/components/ContextMenu";
import { DataPanel } from "../src/components/DataPanel";
import { Header } from "../src/components/Header";
import { HeaderMenu, type HeaderPanel } from "../src/components/HeaderMenu";
import { ItemCard } from "../src/components/ItemCard";
import { Tabs } from "../src/components/Tabs";
import { completionLabels, theme } from "../src/components/theme";
import { useAuth } from "../src/hooks/useAuth";

type Tab = "incomplete" | "completed";

export default function Home() {
  const { signOut } = useAuth();

  const [category, setCategory] = useState<RecCategory>("movie");
  const [tab, setTab] = useState<Tab>("incomplete");
  const [items, setItems] = useState<RecItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RecItem | null>(null);

  const [menuTarget, setMenuTarget] = useState<{
    item: RecItem;
    anchor: { x: number; y: number };
  } | null>(null);

  const [panel, setPanel] = useState<HeaderPanel | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [exportText, setExportText] = useState("");

  const load = useCallback(async (cat: RecCategory, opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await api.listItems(cat);
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(category);
  }, [category, load]);

  const { visible, counts } = useMemo(() => {
    let inc = 0;
    let comp = 0;
    for (const it of items) {
      if (it.completed) comp++;
      else inc++;
    }
    const filtered = items
      .filter((i) => (tab === "completed" ? i.completed : !i.completed))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    return { visible: filtered, counts: { incomplete: inc, completed: comp } };
  }, [items, tab]);

  function closeAllMenus() {
    setCategoryMenuOpen(false);
    setHeaderMenuOpen(false);
  }

  function handleCategorySelect(c: RecCategory) {
    setCategory(c);
    setTab("incomplete");
    setCategoryMenuOpen(false);
  }

  async function handleAdd(title: string) {
    setAddOpen(false);
    try {
      await api.createItem({ title, category });
      await load(category, { silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add");
    }
  }

  async function handleEdit(newTitle: string) {
    if (!editTarget) return;
    const target = editTarget;
    setEditTarget(null);
    try {
      await api.updateItem(target.id, { title: newTitle });
      await load(category, { silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to edit");
    }
  }

  async function handleIncrement(item: RecItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, count: i.count + 1 } : i)));
    try {
      await api.incrementItem(item.id);
    } catch {
      load(category, { silent: true });
    }
  }

  async function handleDecrement(item: RecItem) {
    if (item.count <= 1) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, count: i.count - 1 } : i)));
    }
    try {
      await api.decrementItem(item.id);
    } catch {
      load(category, { silent: true });
    }
  }

  async function handleToggleComplete(item: RecItem) {
    setMenuTarget(null);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed: !i.completed } : i)));
    try {
      await api.updateItem(item.id, { completed: !item.completed });
    } catch {
      load(category, { silent: true });
    }
  }

  async function handleDelete(item: RecItem) {
    setMenuTarget(null);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.deleteItem(item.id);
    } catch {
      load(category, { silent: true });
    }
  }

  async function handlePanelSubmit(text: string) {
    if (!panel) return;
    setPanelLoading(true);
    try {
      if (panel === "paste") {
        const titles = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        await api.bulkImport({ category, titles });
      } else if (panel === "importCsv") {
        await api.importCsv({ csv: text });
      }
      setPanel(null);
      await load(category, { silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    } finally {
      setPanelLoading(false);
    }
  }

  async function openPanel(p: HeaderPanel) {
    setHeaderMenuOpen(false);
    setPanel(p);
    if (p === "exportCsv") {
      try {
        const res = await api.exportCsv();
        setExportText(res.csv);
      } catch (e) {
        setExportText("");
        setError(e instanceof Error ? e.message : "export failed");
      }
    }
  }

  const emptyLabel = completionLabels[category][tab];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Header
          category={category}
          categoryMenuOpen={categoryMenuOpen}
          onToggleCategoryMenu={() => {
            setHeaderMenuOpen(false);
            setCategoryMenuOpen((v) => !v);
          }}
          onToggleHeaderMenu={() => {
            setCategoryMenuOpen(false);
            setHeaderMenuOpen((v) => !v);
          }}
        />

        <Tabs category={category} active={tab} onChange={setTab} counts={counts} />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.text} />
          </View>
        ) : (
          <Pressable style={styles.listWrap} onPress={closeAllMenus}>
            <FlatList
              style={styles.list}
              contentContainerStyle={styles.listContent}
              data={visible}
              keyExtractor={(i) => i.id}
              refreshControl={
                <RefreshControl
                  tintColor={theme.text}
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    load(category);
                  }}
                />
              }
              ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No {emptyLabel.toLowerCase()} items</Text>
                  <Text style={styles.emptyBody}>Tap + to add your first recommendation.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <ItemCard
                  item={item}
                  onIncrement={() => handleIncrement(item)}
                  onDecrement={() => handleDecrement(item)}
                  onOpenMenu={(anchor) => setMenuTarget({ item, anchor })}
                />
              )}
            />
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={() => {
            closeAllMenus();
            setAddOpen(true);
          }}
          accessibilityLabel="Add item"
        >
          <Text style={styles.fabText}>＋</Text>
        </Pressable>

        {categoryMenuOpen ? (
          <CategoryDropdown active={category} onSelect={handleCategorySelect} />
        ) : null}

        {headerMenuOpen ? (
          <HeaderMenu
            onSelect={openPanel}
            onSignOut={() => {
              setHeaderMenuOpen(false);
              signOut();
            }}
          />
        ) : null}

        {headerMenuOpen || categoryMenuOpen ? (
          <Pressable style={styles.menuScrim} onPress={closeAllMenus} />
        ) : null}

        <AddEditModal
          visible={addOpen}
          mode="add"
          category={category}
          onDismiss={() => setAddOpen(false)}
          onSubmit={handleAdd}
        />

        <AddEditModal
          visible={editTarget !== null}
          mode="edit"
          category={category}
          initialTitle={editTarget?.title ?? ""}
          onDismiss={() => setEditTarget(null)}
          onSubmit={handleEdit}
        />

        <ContextMenu
          visible={menuTarget !== null}
          anchor={menuTarget?.anchor ?? null}
          completed={menuTarget?.item.completed ?? false}
          onDismiss={() => setMenuTarget(null)}
          onToggleComplete={() => menuTarget && handleToggleComplete(menuTarget.item)}
          onEdit={() => {
            if (!menuTarget) return;
            const it = menuTarget.item;
            setMenuTarget(null);
            setEditTarget(it);
          }}
          onDelete={() => menuTarget && handleDelete(menuTarget.item)}
        />

        <DataPanel
          visible={panel !== null}
          mode={panel ?? "paste"}
          exportText={exportText}
          loading={panelLoading}
          onDismiss={() => setPanel(null)}
          onSubmit={handlePanelSubmit}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    ...(Platform.OS === "web" ? { maxWidth: 480, width: "100%", alignSelf: "center" } : null),
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingVertical: 6, paddingBottom: 120 },
  empty: { padding: 48, alignItems: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: theme.text, marginBottom: 6 },
  emptyBody: { color: theme.textMuted, fontSize: 14 },
  error: { color: theme.red, padding: 16, textAlign: "center" },
  fab: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { fontSize: 32, color: "#fff", fontWeight: "400", lineHeight: 36, marginTop: -2 },
  menuScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: 40,
  },
});
