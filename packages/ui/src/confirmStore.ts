export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling on the confirm button. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
}

type Listener = (current: ConfirmRequest | null) => void;

/**
 * The queue behind the in-app confirm dialog. `request()` returns the same
 * `Promise<boolean>` the `confirm()` API always has; the mounted host shows
 * one request at a time and calls `settle(id, answer)`. Requests made while
 * one is open wait their turn. Pure (no React, no DOM) so it is unit-tested.
 */
export function createConfirmStore() {
  const queue: { request: ConfirmRequest; resolve: (v: boolean) => void }[] = [];
  const listeners = new Set<Listener>();
  let nextId = 1;
  let hosts = 0;

  const current = () => queue[0]?.request ?? null;
  const emit = () => {
    const c = current();
    for (const l of listeners) l(c);
  };

  return {
    /** True while a dialog host is mounted (Workshop web). */
    hasHost: () => hosts > 0,
    registerHost(): () => void {
      hosts += 1;
      return () => {
        hosts -= 1;
        // A host unmounting mid-question answers "no" rather than hanging.
        if (hosts === 0) {
          while (queue.length) queue.shift()?.resolve(false);
          emit();
        }
      };
    },
    request(options: ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        queue.push({ request: { ...options, id: nextId++ }, resolve });
        if (queue.length === 1) emit();
      });
    },
    settle(id: number, answer: boolean) {
      const head = queue[0];
      if (!head || head.request.id !== id) return;
      queue.shift();
      head.resolve(answer);
      emit();
    },
    current,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app-wide store `confirm()` and `ConfirmDialogHost` share. */
export const confirmStore = createConfirmStore();
