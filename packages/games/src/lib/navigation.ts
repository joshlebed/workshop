import { type Href, router } from "expo-router";

export function goBack(fallbackHref: string) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref as Href);
}
