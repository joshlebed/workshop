import { getItem, setItem } from "./storage";

export type HomeTab = "lists" | "games";

const PREFERRED_HOME_TAB_KEY = "workshop.navigation.preferred-home-tab";

export function homeTabForPathname(pathname: string): HomeTab | null {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? pathname;

  if (clean === "/games" || clean.startsWith("/games/")) return "games";
  if (
    clean === "/" ||
    clean === "/profile" ||
    clean === "/create-list" ||
    clean.startsWith("/create-list/") ||
    clean.startsWith("/list/")
  ) {
    return "lists";
  }

  return null;
}

export async function getPreferredHomeTab(): Promise<HomeTab> {
  const value = await getItem(PREFERRED_HOME_TAB_KEY);
  return value === "games" ? "games" : "lists";
}

export async function setPreferredHomeTab(tab: HomeTab): Promise<void> {
  await setItem(PREFERRED_HOME_TAB_KEY, tab);
}
