// The route table: one entry per (variant, route).
//
// `apps/highscore/app/` is a single flattened tree covering the union of all
// five variants' routes, and every route file is a two-line dispatcher that
// renders `<UxRoute name="…" />`. This is the table it dispatches through.
//
// A variant that never defined a route gets an explicit fallback (see
// `./deepLinks.tsx` and the mapping table in `apps/highscore/UX-PLAYGROUND.md`),
// never a blank screen.

import type { ComponentType } from "react";
import { AppShell as Ux1Home } from "../variants/ux1/deck/AppShell";
import Ux1FriendAccept from "../variants/ux1/games/screens/FriendAccept";
import Ux1GameShareLanding from "../variants/ux1/games/screens/GameShareLanding";
import Ux1PickGame from "../variants/ux1/games/screens/PickGame";
import Ux1EditProfile from "../variants/ux1/screens/EditProfile";
import Ux1Privacy from "../variants/ux1/screens/legal/Privacy";
import Ux1Support from "../variants/ux1/screens/legal/Support";
import Ux1Onboarding from "../variants/ux1/screens/OnboardingDisplayName";
import Ux1SignIn from "../variants/ux1/screens/SignIn";
import Ux2FriendAccept from "../variants/ux2/games/screens/FriendAccept";
import Ux2GameShareLanding from "../variants/ux2/games/screens/GameShareLanding";
import Ux2PickGame from "../variants/ux2/games/screens/PickGame";
import Ux2EditProfile from "../variants/ux2/screens/EditProfile";
import Ux2Privacy from "../variants/ux2/screens/legal/Privacy";
import Ux2Support from "../variants/ux2/screens/legal/Support";
import Ux2Onboarding from "../variants/ux2/screens/OnboardingDisplayName";
import Ux2SignIn from "../variants/ux2/screens/SignIn";
import Ux3FriendAccept from "../variants/ux3/games/screens/FriendAccept";
import Ux3GameShareLanding from "../variants/ux3/games/screens/GameShareLanding";
import Ux3PickGame from "../variants/ux3/games/screens/PickGame";
import Ux3Privacy from "../variants/ux3/screens/legal/Privacy";
import Ux3Support from "../variants/ux3/screens/legal/Support";
import Ux3Onboarding from "../variants/ux3/screens/OnboardingDisplayName";
import Ux3SignIn from "../variants/ux3/screens/SignIn";
import Ux4FriendAccept from "../variants/ux4/games/screens/FriendAccept";
import Ux4FriendProfile from "../variants/ux4/games/screens/FriendProfile";
import Ux4FriendsHome from "../variants/ux4/games/screens/FriendsHome";
import Ux4GameBoard from "../variants/ux4/games/screens/GameBoard";
import Ux4GameShareLanding from "../variants/ux4/games/screens/GameShareLanding";
import { GamesHome as Ux4GamesHome } from "../variants/ux4/games/screens/GamesHome";
import Ux4PickGame from "../variants/ux4/games/screens/PickGame";
import Ux4EditProfile from "../variants/ux4/screens/EditProfile";
import Ux4Privacy from "../variants/ux4/screens/legal/Privacy";
import Ux4Support from "../variants/ux4/screens/legal/Support";
import Ux4Onboarding from "../variants/ux4/screens/OnboardingDisplayName";
import Ux4SignIn from "../variants/ux4/screens/SignIn";
import Ux4You from "../variants/ux4/screens/You";
import Ux5FriendAccept from "../variants/ux5/games/screens/FriendAccept";
import Ux5FriendProfile from "../variants/ux5/games/screens/FriendProfile";
import Ux5FriendsHome from "../variants/ux5/games/screens/FriendsHome";
import Ux5GameBoard from "../variants/ux5/games/screens/GameBoard";
import Ux5GameShareLanding from "../variants/ux5/games/screens/GameShareLanding";
import { GamesHome as Ux5GamesHome } from "../variants/ux5/games/screens/GamesHome";
import Ux5PickGame from "../variants/ux5/games/screens/PickGame";
import Ux5EditProfile from "../variants/ux5/screens/EditProfile";
import Ux5Privacy from "../variants/ux5/screens/legal/Privacy";
import Ux5Support from "../variants/ux5/screens/legal/Support";
import Ux5Onboarding from "../variants/ux5/screens/OnboardingDisplayName";
import Ux5SignIn from "../variants/ux5/screens/SignIn";
import Ux5You from "../variants/ux5/screens/You";
import {
  RedirectToProfile,
  RenderedByLayout,
  Ux1FriendProfileDeepLink,
  Ux1FriendsDeepLink,
  Ux1GameDeepLink,
  Ux1YouDeepLink,
} from "./deepLinks";
import { useUxVariant } from "./variant";
import type { UxVariant } from "./variants";

/**
 * The union of every variant's routes. The first six are the "surface" routes
 * that live inside `app/(app)/`, which is where ux2's shell and ux3's timeline
 * mount; the rest are full screens at the root of `app/`.
 */
export type UxRouteName =
  | "home"
  | "game"
  | "friends"
  | "friendProfile"
  | "profile"
  | "you"
  | "friendAccept"
  | "gameShare"
  | "share"
  | "sharePickGame"
  | "signIn"
  | "onboarding"
  | "support"
  | "privacy";

type RouteTable = Record<UxRouteName, ComponentType>;

const UX1: RouteTable = {
  home: Ux1Home,
  game: Ux1GameDeepLink,
  friends: Ux1FriendsDeepLink,
  friendProfile: Ux1FriendProfileDeepLink,
  profile: Ux1EditProfile,
  you: Ux1YouDeepLink,
  friendAccept: Ux1FriendAccept,
  gameShare: Ux1GameShareLanding,
  share: Ux1PickGame,
  sharePickGame: Ux1PickGame,
  signIn: Ux1SignIn,
  onboarding: Ux1Onboarding,
  support: Ux1Support,
  privacy: Ux1Privacy,
};

const UX2: RouteTable = {
  // The `(shell)` layout draws `/`, `/games/:id`, `/friends` and
  // `/friends/:userId`; those routes render nothing on purpose.
  home: RenderedByLayout,
  game: RenderedByLayout,
  friends: RenderedByLayout,
  friendProfile: RenderedByLayout,
  profile: Ux2EditProfile,
  you: RedirectToProfile,
  friendAccept: Ux2FriendAccept,
  gameShare: Ux2GameShareLanding,
  share: Ux2PickGame,
  sharePickGame: Ux2PickGame,
  signIn: Ux2SignIn,
  onboarding: Ux2Onboarding,
  support: Ux2Support,
  privacy: Ux2Privacy,
};

const UX3: RouteTable = {
  // Every sheet route renders nothing: `SheetHost` reads the URL and draws the
  // sheet over the timeline. `/profile` is ux3's account surface.
  home: RenderedByLayout,
  game: RenderedByLayout,
  friends: RenderedByLayout,
  friendProfile: RenderedByLayout,
  profile: RenderedByLayout,
  you: RedirectToProfile,
  friendAccept: Ux3FriendAccept,
  gameShare: Ux3GameShareLanding,
  share: Ux3PickGame,
  sharePickGame: Ux3PickGame,
  signIn: Ux3SignIn,
  onboarding: Ux3Onboarding,
  support: Ux3Support,
  privacy: Ux3Privacy,
};

const UX4: RouteTable = {
  home: Ux4GamesHome,
  game: Ux4GameBoard,
  friends: Ux4FriendsHome,
  friendProfile: Ux4FriendProfile,
  profile: Ux4EditProfile,
  you: Ux4You,
  friendAccept: Ux4FriendAccept,
  gameShare: Ux4GameShareLanding,
  share: Ux4PickGame,
  sharePickGame: Ux4PickGame,
  signIn: Ux4SignIn,
  onboarding: Ux4Onboarding,
  support: Ux4Support,
  privacy: Ux4Privacy,
};

const UX5: RouteTable = {
  home: Ux5GamesHome,
  game: Ux5GameBoard,
  friends: Ux5FriendsHome,
  friendProfile: Ux5FriendProfile,
  profile: Ux5EditProfile,
  you: Ux5You,
  friendAccept: Ux5FriendAccept,
  gameShare: Ux5GameShareLanding,
  share: Ux5PickGame,
  sharePickGame: Ux5PickGame,
  signIn: Ux5SignIn,
  onboarding: Ux5Onboarding,
  support: Ux5Support,
  privacy: Ux5Privacy,
};

export const UX_ROUTES: Record<UxVariant, RouteTable> = {
  ux1: UX1,
  ux2: UX2,
  ux3: UX3,
  ux4: UX4,
  ux5: UX5,
};

/** The whole body of every file in `app/`. */
export function UxRoute({ name }: { name: UxRouteName }) {
  const variant = useUxVariant();
  const Screen = UX_ROUTES[variant][name];
  return <Screen />;
}
