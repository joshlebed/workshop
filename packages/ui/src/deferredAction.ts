/**
 * Holds one action until a closing surface has finished animating out.
 *
 * iOS drops a Modal or Alert presented while another Modal is still
 * dismissing (the sheet stays mounted ~220ms for its exit animation), so a
 * menu must not run the chosen action from the tap itself. `defer(fn)`
 * stores it; the sheet's `onClosed` calls `flush()`, which runs it once.
 * A later `defer` replaces an earlier one; `cancel()` drops it.
 */
export function createDeferredAction() {
  let pending: (() => void) | null = null;
  return {
    defer(action: () => void) {
      pending = action;
    },
    flush() {
      const action = pending;
      pending = null;
      action?.();
    },
    cancel() {
      pending = null;
    },
    get hasPending() {
      return pending !== null;
    },
  };
}
