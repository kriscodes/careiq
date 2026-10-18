import { catalogs, type MessageValues } from "../../../../packages/i18n";

type Translator = (key: string, values?: MessageValues) => string;
const keyForText = new Map<string, string>();
for (const catalog of Object.values(catalogs)) for (const [key, value] of Object.entries(catalog)) keyForText.set(value, key);
const interpolated = [...keyForText].filter(([text]) => /\{[A-Za-z]\w*\}/.test(text) && !/\{[^}]*,/.test(text)).map(([text, key]) => {
  const fields: string[] = [];
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{([A-Za-z]\w*)\\\}/g, (_, field: string) => { fields.push(field); return "([\\s\\S]+?)"; });
  return { key, fields, pattern: new RegExp(`^${escaped}$`) };
});
/** Only catalog-authored notifications are retranslated; patient and practice content never enters this helper. */
export function localizeNotice(t: Translator, text: string): string {
  if (!text) return text;
  const key = keyForText.get(text);
  if (key) return t(key);
  for (const entry of interpolated) {
    const match = entry.pattern.exec(text);
    if (match) return t(entry.key, Object.fromEntries(entry.fields.map((field, index) => {
      const value = match[index + 1];
      const nestedKey = field === "retry" ? keyForText.get(value) : undefined;
      return [field, nestedKey ? t(nestedKey) : value];
    })));
  }
  return text;
}
