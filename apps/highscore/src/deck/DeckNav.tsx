// The whole app is one screen. This holds where you are inside it.
//
// HighScore does not push a route to show you a game, your friends, or your
// account: the deck (a horizontal run of full-screen game cartridges), the
// players panel and the you panel are three states of a single surface, and
// moving between them is a stepped crossfade, never a stack transition.
//
// The router still owns deep links. `/games/:id`, `/friends`,
// `/friends/:userId` and `/profile` are real routes that hand their target to
// `applyDeepLink` and land you on the right state of this one screen.

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type Panel = "deck" | "players" | "you";

/** Panel order — a switch's direction drives which way its 8px step slides. */
export const PANEL_ORDER: Panel[] = ["deck", "players", "you"];

export interface DeckNavValue {
  panel: Panel;
  /** Which cartridge the deck is parked on, by game id. Null = first / slot. */
  gameId: string | null;
  /** Deck is zoomed out to the shelf. */
  shelfOpen: boolean;
  /** Friend being viewed inside the players panel; null = the roster. */
  playerId: string | null;
  /** Play-link vouch token for `playerId` (from `/g/:token`). */
  playerVia: string | null;
  setPanel: (panel: Panel) => void;
  /** Park the deck on a cartridge without changing panel (pager scroll). */
  setGameId: (gameId: string | null) => void;
  openGame: (gameId: string) => void;
  setShelfOpen: (open: boolean) => void;
  openPlayer: (userId: string, via?: string | null) => void;
  closePlayer: () => void;
}

const DeckNavContext = createContext<DeckNavValue | null>(null);

export interface DeepLink {
  panel?: Panel;
  gameId?: string | null;
  playerId?: string | null;
  playerVia?: string | null;
}

export function DeckNavProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<Panel>("deck");
  const [gameId, setGameId] = useState<string | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerVia, setPlayerVia] = useState<string | null>(null);

  const setPanel = useCallback((next: Panel) => {
    setPanelState(next);
    setShelfOpen(false);
    // Leaving the players panel drops the drill-in, so coming back lands on
    // the roster rather than a stale profile.
    if (next !== "players") {
      setPlayerId(null);
      setPlayerVia(null);
    }
  }, []);

  const openGame = useCallback((id: string) => {
    setGameId(id);
    setPanelState("deck");
    setShelfOpen(false);
  }, []);

  const openPlayer = useCallback((userId: string, via?: string | null) => {
    setPlayerId(userId);
    setPlayerVia(via ?? null);
    setPanelState("players");
    setShelfOpen(false);
  }, []);

  const closePlayer = useCallback(() => {
    setPlayerId(null);
    setPlayerVia(null);
  }, []);

  const value = useMemo(
    () => ({
      panel,
      gameId,
      shelfOpen,
      playerId,
      playerVia,
      setPanel,
      setGameId,
      openGame,
      setShelfOpen,
      openPlayer,
      closePlayer,
    }),
    [panel, gameId, shelfOpen, playerId, playerVia, setPanel, openGame, openPlayer, closePlayer],
  );

  return <DeckNavContext.Provider value={value}>{children}</DeckNavContext.Provider>;
}

export function useDeckNav(): DeckNavValue {
  const value = useContext(DeckNavContext);
  if (!value) throw new Error("useDeckNav must be used inside DeckNavProvider");
  return value;
}

/** Index distance between two panels — sign gives the slide direction. */
export function panelDelta(from: Panel, to: Panel): number {
  return PANEL_ORDER.indexOf(to) - PANEL_ORDER.indexOf(from);
}
