export type AccountRestoreOptions = { userId: string; operatorReference: string; environment: "development" | "production"; confirmation: "RESTORE" };
/** Strict operator-only CLI input; there is no public account-restoration route. */
export function parseAccountRestoreArguments(args: string[]): AccountRestoreOptions {
  const allowed = ["--user-id", "--reference", "--confirm", "--environment"];
  const values = new Map<string, string>();
  if (args.length !== 8) throw new Error("RESTORE_ARGUMENTS_INVALID");
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.includes(key) || values.has(key) || !value || value.startsWith("--")) throw new Error("RESTORE_ARGUMENTS_INVALID");
    values.set(key, value);
  }
  const userId = values.get("--user-id")!, operatorReference = values.get("--reference")!, environment = values.get("--environment");
  if (!/^user_[A-Za-z0-9]+$/.test(userId) || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{2,127}$/.test(operatorReference) || values.get("--confirm") !== "RESTORE" || !["development", "production"].includes(environment!)) throw new Error("RESTORE_ARGUMENTS_INVALID");
  return { userId, operatorReference, environment: environment as AccountRestoreOptions["environment"], confirmation: "RESTORE" };
}
