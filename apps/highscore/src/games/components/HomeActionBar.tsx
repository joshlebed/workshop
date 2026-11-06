// The Games home's one write: a round pink "+" floating bottom-right. It opens
// the post screen (`/share`), where you paste a score and, from the top of
// "Your games", add more games. The card list pads its tail by
// `homeActionBarListInset` so the last card clears the button.
//
// The disc is pixel art on a 3px grid, drawn from plain Views (no SVG —
// DESIGN.md "Iconography": View-drawn pixel art keeps the runtime OTA-safe):
// 14×14 cells shaded per cell like a softly lit arcade button (light from the
// top-left), in a muted pink ramp so the filled shape doesn't shout. The drop
// shadow is a native one, cast by a round View tucked just inside the stepped
// edge so its blur reads as a soft circle under the pixels. Pressing sinks the
// button and tightens the shadow.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { homeLayout, tokens } from "../../theme";
import { actionBarBottomPadding } from "../lib/actionBar";

const PX = 3;
const CELLS = 14;
const DISC = PX * CELLS; // 42
const SHADOW_ROOM = 6; // blur/offset headroom below the disc
const FAB_SIZE = DISC + SHADOW_ROOM;
const FAB_GAP = tokens.space.md;

// A muted pink ramp, narrow on purpose: enough steps to read as a lit dome,
// not so many that it turns into a glossy candy.
const TONE = {
  shine: "#F3A6C9",
  light: "#EA84B4",
  base: "#DE689F",
  shade: "#CA5A8F",
  rim: "#AE4C7B",
} as const;
type Tone = keyof typeof TONE;
const PLUS = "#2A0E21";

interface Run {
  id: string;
  x: number;
  y: number;
  w: number;
  tone: Tone;
}

/** Per-cell lighting for a dome-ish disc, merged into horizontal runs. */
function buildDisc(): Run[] {
  const r = CELLS / 2;
  // Light from the top-left, a little in front.
  const [lx, ly, lz] = normalize([-0.55, -0.65, 0.52]);
  const runs: Run[] = [];
  for (let row = 0; row < CELLS; row++) {
    let run: Run | null = null;
    for (let col = 0; col < CELLS; col++) {
      const x = col + 0.5 - r;
      const y = row + 0.5 - r;
      const d2 = x * x + y * y;
      if (d2 > r * r) continue;
      const d = Math.sqrt(d2) / r;
      const z = Math.sqrt(Math.max(0, 1 - d * d));
      const i = (x / r) * lx + (y / r) * ly + z * lz;
      const tone: Tone =
        d > 0.9 ? "rim" : i > 0.92 ? "shine" : i > 0.66 ? "light" : i > 0.3 ? "base" : "shade";
      if (run && run.tone === tone && run.x + run.w === col) {
        run.w += 1;
      } else {
        run = { id: `${row}-${col}`, x: col, y: row, w: 1, tone };
        runs.push(run);
      }
    }
  }
  return runs;
}

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
}

const DISC_RUNS = buildDisc();

// Plus: 8 cells long, 2 thick (24px × 6px), centred on the 14-cell grid.
const PLUS_LONG = PX * 8;
const PLUS_THICK = PX * 2;
const PLUS_OFFSET = (DISC - PLUS_LONG) / 2; // 9
const PLUS_BAR = (DISC - PLUS_THICK) / 2; // 18
// The shadow caster sits a cell inside the stepped edge so it never peeks out.
const CASTER_INSET = PX;

/** Tail room the card list needs so the last card clears the floating button. */
export function homeActionBarListInset(insetBottom: number): number {
  return FAB_SIZE + FAB_GAP + actionBarBottomPadding(insetBottom, tokens.space.md);
}

export interface HomeActionBarProps {
  insetBottom: number;
  onPress: () => void;
}

export function HomeActionBar({ insetBottom, onPress }: HomeActionBarProps) {
  const bottom = actionBarBottomPadding(insetBottom, tokens.space.md);
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" testID="home-action-bar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post a score or add a game"
        onPress={() => {
          haptics.light();
          onPress();
        }}
        testID="home-paste-score"
        style={styles.fab}
      >
        {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
          <View
            pointerEvents="none"
            style={[
              styles.button,
              hovered && !pressed && styles.buttonHover,
              pressed && styles.buttonPressed,
            ]}
          >
            <View style={[styles.caster, pressed && styles.casterPressed]} />
            {DISC_RUNS.map((r) => (
              <View
                key={r.id}
                style={{
                  position: "absolute",
                  left: r.x * PX,
                  top: r.y * PX,
                  width: r.w * PX,
                  height: PX,
                  backgroundColor: TONE[r.tone],
                }}
              />
            ))}
            <View style={[styles.bar, styles.barH]} />
            <View style={[styles.bar, styles.barV]} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: homeLayout.horizontalInset,
  },
  fab: { width: DISC, height: FAB_SIZE },
  button: { position: "absolute", left: 0, top: 0, width: DISC, height: DISC },
  buttonHover: { transform: [{ translateY: 1 }] },
  buttonPressed: { transform: [{ translateY: 2 }] },
  // Native drop shadow: a soft plum-black halo, offset down.
  caster: {
    position: "absolute",
    left: CASTER_INSET,
    top: CASTER_INSET,
    width: DISC - CASTER_INSET * 2,
    height: DISC - CASTER_INSET * 2,
    borderRadius: (DISC - CASTER_INSET * 2) / 2,
    backgroundColor: TONE.rim,
    shadowColor: "#05030A",
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  casterPressed: {
    shadowOpacity: 0.45,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  bar: { position: "absolute", backgroundColor: PLUS },
  barH: { left: PLUS_OFFSET, top: PLUS_BAR, width: PLUS_LONG, height: PLUS_THICK },
  barV: { left: PLUS_BAR, top: PLUS_OFFSET, width: PLUS_THICK, height: PLUS_LONG },
});
