// HighScore home-screen widget (WidgetKit, small + medium). Generated into the
// Xcode project by `@bacons/apple-targets` at prebuild; the Swift source is
// `HighScoreWidget.swift` beside this file. It reads the snapshot the app
// writes into the shared App Group (`src/lib/homeWidget.ts`) and never talks
// to the network. See apps/highscore/CLAUDE.md → "Home-screen widget".

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "HighScoreWidget",
  displayName: "HighScore",
  bundleIdentifier: ".widget",
  // WidgetKit's containerBackground / interactive-free API surface we use is
  // iOS 17+; the app itself runs on older iOS, where the widget simply isn't
  // offered.
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit"],
  colors: {
    $widgetBackground: "#121216",
    $accent: "#FF3D9A",
  },
  entitlements: {
    // The same group the app and the share extension use (app.json).
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
