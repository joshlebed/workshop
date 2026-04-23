const SESSION_KEY = "workshop.session";

export async function saveSession(token: string): Promise<void> {
  window.localStorage.setItem(SESSION_KEY, token);
}

export async function loadSession(): Promise<string | null> {
  return window.localStorage.getItem(SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  window.localStorage.removeItem(SESSION_KEY);
}
