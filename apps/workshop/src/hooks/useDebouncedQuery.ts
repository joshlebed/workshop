import { useEffect, useState } from "react";

/**
 * Returns `value` after `delayMs` of stable input. Trailing-edge debounce —
 * fast typing only fires once at the end. Used by the add-item search modal
 * to throttle TMDB / Google Books queries to the backend's 60/min/user
 * rate limit.
 */
export function useDebouncedQuery(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
