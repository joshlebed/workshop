/**
 * The current calendar day in the user's locale, formatted as YYYY-MM-DD.
 * Built from date parts (not `toISOString()`) so east-of-UTC users don't land
 * in the wrong day near midnight.
 */
export function localDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
