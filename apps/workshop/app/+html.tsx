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
              /* Use the dynamic viewport so the layout shrinks with the iOS
                 keyboard instead of the keyboard covering the page. */
              #root { min-height: 100dvh; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
