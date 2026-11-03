// The pinned add-by-link footer on the Add-game screen, in five treatments
// under evaluation (picked with `VariantPicker`, persisted). All share one
// mutation (`useAddByUrl`) and one frame (`footerStyles`); they differ only in
// how a link gets into the box. Each variant's header comment says why.

import { getItem, setItem } from "@workshop/api-client/storage";
import type { Game } from "@workshop/shared/games";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "../../../../theme";
import { footerStyles } from "./footerStyles";
import {
  DEFAULT_URL_FOOTER_VARIANT,
  parseUrlFooterVariant,
  URL_FOOTER_VARIANT_STORAGE_KEY,
  type UrlFooterVariant,
} from "./urlFooter";
import { useAddByUrl } from "./useAddByUrl";
import { Variant1PasteInField } from "./Variant1PasteInField";
import { Variant2ClipboardSuggestion } from "./Variant2ClipboardSuggestion";
import { Variant3TwoButtons } from "./Variant3TwoButtons";
import { Variant4MorphButton } from "./Variant4MorphButton";
import { Variant5Sheet } from "./Variant5Sheet";
import { VariantPicker } from "./VariantPicker";

export function AddByUrlFooter({ onAdded }: { onAdded: (game: Game) => void | Promise<void> }) {
  const insets = useSafeAreaInsets();
  const add = useAddByUrl(onAdded);
  const [variant, setVariant] = useState<UrlFooterVariant>(DEFAULT_URL_FOOTER_VARIANT);

  useEffect(() => {
    let alive = true;
    void getItem(URL_FOOTER_VARIANT_STORAGE_KEY).then((raw) => {
      if (alive) setVariant(parseUrlFooterVariant(raw));
    });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (next: UrlFooterVariant) => {
    setVariant(next);
    add.setDraft("");
    void setItem(URL_FOOTER_VARIANT_STORAGE_KEY, next);
  };

  return (
    <View
      style={[footerStyles.footer, { paddingBottom: Math.max(insets.bottom, tokens.space.md) }]}
      testID={`add-game-url-footer-${variant}`}
    >
      <VariantPicker value={variant} onChange={pick} />
      {variant === "1" ? (
        <Variant1PasteInField add={add} />
      ) : variant === "2" ? (
        <Variant2ClipboardSuggestion add={add} />
      ) : variant === "3" ? (
        <Variant3TwoButtons add={add} />
      ) : variant === "4" ? (
        <Variant4MorphButton add={add} />
      ) : (
        <Variant5Sheet add={add} />
      )}
    </View>
  );
}
