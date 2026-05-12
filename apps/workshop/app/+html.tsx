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
 *     white on top of an otherwise-dark app. We set it explicitly and honor
 *     `prefers-color-scheme`.
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
        <meta name="theme-color" content="#0E0E10" />
        <ScrollViewStyleReset />
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input
          dangerouslySetInnerHTML={{
            __html: `
              html, body { background-color: #FAFAFB; }
              @media (prefers-color-scheme: dark) {
                html, body { background-color: #0E0E10; }
              }
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
