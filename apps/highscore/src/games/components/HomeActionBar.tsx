// The Games home's one write: a round pink "+" floating bottom-right. It opens
// the post screen (`/share`), where you paste a score and, from the top of
// "Your games", add more games. The card list pads its tail by
// `homeActionBarListInset` so the last card clears the button.
//
// Drawn as pixel art on a 4px grid, from plain Views (no SVG — DESIGN.md
// "Iconography": View-drawn pixel art keeps the runtime OTA-safe):
//   - a 16×16-cell disc, shaded per cell like a lit arcade button (light from
//     the top-left: highlight → base → shade → rim), in a softer pink than the
//     interactive neon so the big filled shape doesn't shout;
//   - a hard, stepped drop shadow in deep plum, offset down-right, so the
//     button sits *on* the page;
//   - a 2-cell-thick plus with its own 1-cell shadow.
// Pressing pushes the button down onto its shadow, like a real arcade button.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { homeLayout, tokens } from "../../theme";
import { actionBarBottomPadding } from "../lib/actionBar";

const PX = 4;
const CELLS = 16;
const DISC = PX * CELLS; // 64
const SHADOW_OFFSET = PX * 2; // two cells down-right
const FAB_SIZE = DISC + SHADOW_OFFSET;
const FAB_GAP = tokens.space.md;

// Button palette: a softened pink ramp (the neon #FF3D9A is the spec's
// interactive accent; at this size a full fill of it is glaring).
const TONE = {
  shine: "#FFB3D6",
  light: "#F77DB6",
  base: "#E2589A",
  shade: "#B9437F",
  rim: "#8A2F5E",
  shadow: "#4E1C44",
  plus: "#2A0E21",
  plusShadow: "#A23A70",
} as const;
type Tone = keyof typeof TONE;

interface Run {
  id: string;
  x: number;
  y: number;
  w: number;
  tone: Tone;
}

/** Per-cell lighting for a sphere-ish disc, merged into horizontal runs. */
function buildDisc(): { shape: Run[]; lit: Run[] } {
  const r = CELLS / 2;
  // Light from the top-left, a little in front.
  const L = normalize([-0.55, -0.65, 0.52]);
  const shape: Run[] = [];
  const lit: Run[] = [];
  for (let row = 0; row < CELLS; row++) {
    let shapeStart = -1;
    let shapeEnd = -1;
    let run: Run | null = null;
    for (let col = 0; col < CELLS; col++) {
      const x = col + 0.5 - r;
      const y = row + 0.5 - r;
      const d2 = x * x + y * y;
      if (d2 > r * r) continue;
      if (shapeStart < 0) shapeStart = col;
      shapeEnd = col;
      const d = Math.sqrt(d2) / r;
      const z = Math.sqrt(Math.max(0, 1 - d * d));
      const i = (x / r) * L[0] + (y / r) * L[1] + z * L[2];
      const tone: Tone =
        d > 0.86 ? "rim" : i > 0.9 ? "shine" : i > 0.62 ? "light" : i > 0.25 ? "base" : "shade";
      if (run && run.tone === tone && run.x + run.w === col) {
        run.w += 1;
      } else {
        run = { id: `${row}-${col}`, x: col, y: row, w: 1, tone };
        lit.push(run);
      }
    }
    if (shapeStart >= 0) {
      shape.push({
        id: `s${row}`,
        x: shapeStart,
        y: row,
        w: shapeEnd - shapeStart + 1,
        tone: "shadow",
      });
    }
  }
  return { shape, lit };
}

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
}

const { shape: SHADOW_RUNS, lit: DISC_RUNS } = buildDisc();

// Plus: 8 cells long, 2 thick (32px × 8px), centred on the 16-cell grid.
const PLUS_LONG = PX * 8;
const PLUS_THICK = PX * 2;
const PLUS_OFFSET = (DISC - PLUS_LONG) / 2; // 16
const PLUS_BAR = (DISC - PLUS_THICK) / 2; // 28

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
          <>
            <Pixels runs={SHADOW_RUNS} offset={SHADOW_OFFSET} />
            <View
              pointerEvents="none"
              style={[
                styles.button,
                pressed && styles.buttonPressed,
                hovered && !pressed && styles.buttonHover,
              ]}
            >
              <Pixels runs={DISC_RUNS} offset={0} />
              {/* plus shadow, one cell down-right */}
              <View style={[styles.bar, styles.barH, styles.plusShadow, styles.nudge]} />
              <View style={[styles.bar, styles.barV, styles.plusShadow, styles.nudge]} />
              <View style={[styles.bar, styles.barH]} />
              <View style={[styles.bar, styles.barV]} />
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
}

function Pixels({ runs, offset }: { runs: Run[]; offset: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {runs.map((r) => (
        <View
          key={r.id}
          style={{
            position: "absolute",
            left: offset + r.x * PX,
            top: offset + r.y * PX,
            width: r.w * PX,
            height: PX,
            backgroundColor: TONE[r.tone],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: homeLayout.horizontalInset,
  },
  fab: { width: FAB_SIZE, height: FAB_SIZE },
  button: { position: "absolute", left: 0, top: 0, width: DISC, height: DISC },
  // Pressed: the button sinks onto its shadow.
  buttonPressed: { transform: [{ translateX: SHADOW_OFFSET }, { translateY: SHADOW_OFFSET }] },
  buttonHover: { transform: [{ translateX: PX }, { translateY: PX }] },
  bar: { position: "absolute", backgroundColor: TONE.plus },
  barH: { left: PLUS_OFFSET, top: PLUS_BAR, width: PLUS_LONG, height: PLUS_THICK },
  barV: { left: PLUS_BAR, top: PLUS_OFFSET, width: PLUS_THICK, height: PLUS_LONG },
  plusShadow: { backgroundColor: TONE.plusShadow },
  nudge: { transform: [{ translateX: PX / 2 }, { translateY: PX / 2 }] },
});
