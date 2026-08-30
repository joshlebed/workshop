import type { ConfigContext, ExpoConfig } from "expo/config";

const STUDIO_BUNDLE_ID = "live.highscore.app.studio";
const STUDIO_APP_GROUP = "group.live.highscore.app.studio";
const STUDIO_SCHEME = "highscore-studio";

function withStudioConfig(config: ExpoConfig): ExpoConfig {
  const plugins = (config.plugins ?? [])
    .filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-dev-client")
    .map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== "expo-share-intent") return plugin;
      return [
        "expo-share-intent",
        {
          ...(plugin[1] ?? {}),
          iosShareExtensionName: "HighScore Studio Share",
          iosAppGroupIdentifier: STUDIO_APP_GROUP,
        },
      ] as [string, Record<string, unknown>];
    });

  plugins.push([
    "expo-dev-client",
    {
      launchMode: "most-recent",
      // Screenshot builds should never show the floating developer control.
      toolsButton: false,
    },
  ]);

  return {
    ...config,
    name: "HighScore Studio",
    scheme: STUDIO_SCHEME,
    ios: {
      ...config.ios,
      bundleIdentifier: STUDIO_BUNDLE_ID,
      entitlements: {
        ...config.ios?.entitlements,
        "com.apple.security.application-groups": [STUDIO_APP_GROUP],
      },
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: "HighScore Studio",
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              "com.googleusercontent.apps.267582241036-7vtcgkd594ldgimcu3dickj9u5ga951l",
              STUDIO_SCHEME,
            ],
          },
        ],
      },
    },
    android: {
      ...config.android,
      package: STUDIO_BUNDLE_ID,
    },
    plugins,
    updates: {
      ...config.updates,
      // Studio always loads the JS bundle from its selected development server.
      enabled: false,
    },
    extra: {
      ...config.extra,
      highScoreStudio: true,
    },
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  let resolved = config as ExpoConfig;
  if (process.env.HIGHSCORE_STUDIO === "1") resolved = withStudioConfig(resolved);

  // Surface the Niteshift preview origin to Expo CLI's CorsMiddleware. The
  // proxy preserves the iframe Origin, so write requests are rejected before
  // dev-api-proxy.js without this explicit allow-list.
  const previewOrigin =
    process.env.NITESHIFT_WEB_APP_EXPO_REACT_NATIVE_WEB_URL ??
    process.env.EXPO_DEV_SERVER_ALLOWED_ORIGIN ??
    null;

  if (!previewOrigin) return resolved;

  return {
    ...resolved,
    extra: {
      ...resolved.extra,
      router: {
        ...(resolved.extra?.router ?? {}),
        // CorsMiddleware whitelists `new URL(origin).host`, so the value
        // needs to be the full URL (scheme + host).
        origin: previewOrigin,
      },
    },
  };
};
