// Native stub. The "open in app" affordance is web-only — there is no in-app
// browser to escape on native (you're already in the app). `isInAppBrowser()`
// is always false on native, so this never renders; it exists only so the
// shared import resolves. The real card is `OpenInAppCard.web.tsx`.

export interface OpenInAppCardProps {
  /** The https Universal Link to open in the native app (NOT a custom scheme). */
  url: string;
  /** Proceed on the web instead. */
  onContinue: () => void;
}

export function OpenInAppCard(_props: OpenInAppCardProps): null {
  return null;
}
