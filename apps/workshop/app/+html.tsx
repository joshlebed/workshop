import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * Root HTML shell for the web build (Expo Router only renders this on web).
 *
 * Two things matter here:
 *  1. `viewport-fit=cover` + `interactive-widget=resizes-content` so iOS Safari
 *     resizes the layout viewport when the on-screen keyboard appears.
 *     Without this, the keyboard floats over the page and the body's bottom
 *     extends past the visual viewport — revealing the default white area
 *     behind the page when the user scrolls.
 *  2. `html`/`body` paint the canvas color end-to-end. The `ScrollViewStyleReset`
 *     pins height to 100%, but Expo's stylesheet doesn't set a background — so
 *     the iOS Safari status-bar / home-indicator overscroll regions render
 *     white on top of an otherwise-dark app. The app shell (`_layout` /
 *     `tokens.bg.canvas`) always paints dark regardless of system color
 *     scheme, so we lock html/body to the same dark canvas — otherwise the
 *     top status-bar area and bottom home-indicator/toolbar area flash white
 *     in iOS light mode.
 *  3. `html, body, #root { height: 100dvh }` gives the whole flex chain a
 *     definite, viewport-bounded height. `ScrollViewStyleReset` sets
 *     `height: 100%` and `body { overflow: hidden }` so the document never
 *     scrolls — only inner ScrollViews do — but the previous override used
 *     `#root { min-height: 100dvh }`, which is *not* a definite height: the
 *     `flex:1` chain below (GestureHandlerRootView → SafeAreaView → screen →
 *     FlatList) couldn't resolve to a bounded box, so the FlatList's inner
 *     `overflow:auto` div had nothing to scroll inside and content was
 *     clipped by `body{overflow:hidden}`. With `height: 100dvh` the dynamic
 *     viewport (iOS Safari URL-bar shrink, keyboard via
 *     `interactive-widget=resizes-content`) drives the sizing and every
 *     FlatList/ScrollView inside scrolls correctly.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        {/* Force the same dark tint in both schemes — the app shell always
            paints a dark canvas, so we don't want Safari's URL bar going
            light when the user's iOS is in light mode. Safari historically
            requires explicit media variants to honor theme-color in light
            mode, so we declare both. */}
        <meta name="theme-color" content="#0E0E10" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#0E0E10" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0E0E10" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <ScrollViewStyleReset />
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input
          dangerouslySetInnerHTML={{
            __html: `
              html, body { background-color: #0E0E10; color-scheme: dark; }
              /* Definite height down the whole chain so flex:1 descendants
                 resolve to a scrollable bounded box. 100dvh tracks the
                 dynamic viewport (iOS URL bar / on-screen keyboard). */
              html, body, #root { height: 100dvh; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
