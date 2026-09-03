import { Easing, type WithTimingConfig } from "react-native-reanimated";
import { STEP_DURATION_MS } from "./tokens";

/**
 * The app's one transition: two hard frames. Nothing eases, nothing
 * overshoots — a panel change advances the machine a frame. Direct
 * manipulation (dragging a cartridge, dragging a tile) is exempt: it tracks
 * the finger 1:1.
 */
export const stepped: WithTimingConfig = {
  duration: STEP_DURATION_MS,
  easing: Easing.steps(2, true),
};

/**
 * The shelf zoom covers more distance than a panel swap, so it gets a third
 * frame — still stepped, still no easing, just long enough to read as the
 * deck pulling back rather than a cut.
 */
export const zoomStepped: WithTimingConfig = {
  duration: STEP_DURATION_MS + 60,
  easing: Easing.steps(3, true),
};
