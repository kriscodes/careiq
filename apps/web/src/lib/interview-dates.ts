// The slice has no practice-timezone field yet. Display and input use the
// browser's local zone; API payloads always carry an explicit UTC instant.
export function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}
export function shiftDate(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
export function weekDates(key: string): string[] {
  const date = dateFromKey(key);
  const offset = (date.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => shiftDate(key, index - offset));
}
