// Temporary evaluation control: which add-by-link footer to show. Persisted so
// a choice survives relaunches while the five treatments are being compared.
// Delete this file (and the losing variants) once one wins.

import { ScrollView, StyleSheet, View } from "react-native";
import { Chip, Text, tokens } from "../../../../theme";
import { URL_FOOTER_VARIANTS, type UrlFooterVariant } from "./urlFooter";

export function VariantPicker({
  value,
  onChange,
}: {
  value: UrlFooterVariant;
  onChange: (next: UrlFooterVariant) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text variant="overline" tone="muted">
        TRYING
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        {URL_FOOTER_VARIANTS.map((v) => (
          <Chip
            key={v.id}
            label={v.label}
            selected={v.id === value}
            onPress={() => onChange(v.id)}
            testID={`add-game-url-variant-${v.id}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  chips: { gap: tokens.space.xs, paddingRight: tokens.space.md },
});
