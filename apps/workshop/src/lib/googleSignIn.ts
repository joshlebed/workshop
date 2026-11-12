/**
 * Whether Google sign-in can render on this platform. Native needs the iOS
 * client id: without it `expo-auth-session`'s Google hook throws on mount
 * ("Client Id property `iosClientId` must be defined"), which took the whole
 * sign-in screen down in a simulator build that had no id. Web reads its own.
 */
export const GOOGLE_SIGN_IN_CONFIGURED = Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
