import { type Href, router } from "expo-router";

/** Navigate back when possible, otherwise replace with the logical parent route. */
export function goBack(fallbackHref: string) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref as Href);
}
