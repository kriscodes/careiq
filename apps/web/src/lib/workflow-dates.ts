export function instantFromLocal(value: string, timeZone: string) {
  const expected = value.slice(0, 16); const [date, time] = expected.split("T"); if (!date || !time) throw new Error("Choose a date and time.");
  const desired = Date.parse(`${expected}:00Z`); if (!Number.isFinite(desired)) throw new Error("Choose a valid appointment time.");
  let candidate = desired;
  const format = (instant: number) => { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant); const get = (key: string) => parts.find(p => p.type === key)?.value; return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`; };
  for (let i = 0; i < 4; i++) { const actual = format(candidate); const delta = desired - Date.parse(`${actual}:00Z`); if (!delta) { const repeated = [-180, -120, -90, -60, -30, 30, 60, 90, 120, 180].some(minutes => format(candidate + minutes * 60000) === expected); if (repeated) throw new Error("This time occurs twice when daylight saving time ends. Choose a time outside the repeated hour."); return new Date(candidate).toISOString(); } candidate += delta; }
  if (format(candidate) !== expected) throw new Error("That time does not exist in this location’s time zone. Choose another time.");
  return new Date(candidate).toISOString();
}
