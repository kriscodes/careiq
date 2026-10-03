import { apiRequest } from "./client";

type ListPage<T> = {
  data: T[];
  meta?: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
};

/** Preserve complete directory/calendar behavior while each server query is bounded. */
export async function getAllPages<T extends { id: string }>(path: string, token: string): Promise<T[]> {
  const records = new Map<string, T>();
  let offset = 0;
  while (true) {
    const page = await apiRequest<ListPage<T>>(`${path}?limit=100&offset=${offset}`, token);
    for (const record of page.data) records.set(record.id, record);
    // Older API versions have no pagination metadata.
    if (!page.meta?.hasMore) return [...records.values()];
    const next = page.meta.nextOffset;
    if (!Number.isSafeInteger(next) || next === null || next <= offset) {
      throw new Error("CareIQ returned an invalid page of records. Please refresh and try again.");
    }
    offset = next;
  }
}
