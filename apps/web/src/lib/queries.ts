import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { api, type RecordFilters } from "./api.js";

export const keys = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  tags: ["tags"] as const,
  records: (filters: RecordFilters) => ["records", filters] as const,
  days: (from: string, to: string) => ["days", from, to] as const,
  day: (date: string) => ["day", date] as const,
};

/** Anything that writes a record or day invalidates all four read surfaces. */
function invalidateJournal(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ["records"] });
  void client.invalidateQueries({ queryKey: ["days"] });
  void client.invalidateQueries({ queryKey: ["day"] });
  void client.invalidateQueries({ queryKey: keys.tags });
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 30_000 });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.settings });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api.tags().then((r) => r.tags) });
}

export function useRecordFeed(filters: RecordFilters) {
  return useInfiniteQuery({
    queryKey: keys.records(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.records({ ...filters, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDays(from: string, to: string) {
  return useQuery({
    queryKey: keys.days(from, to),
    queryFn: () => api.days(from, to).then((r) => r.days),
  });
}

export function useDay(date: string) {
  return useQuery({ queryKey: keys.day(date), queryFn: () => api.day(date) });
}

export function useCreateRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.createRecord,
    onSuccess: () => invalidateJournal(client),
  });
}

export function useUpdateRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Parameters<typeof api.updateRecord>[1]) =>
      api.updateRecord(id, patch),
    onSuccess: () => invalidateJournal(client),
  });
}

export function useDeleteRecord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRecord,
    onSuccess: () => invalidateJournal(client),
  });
}

export function useUpdateDay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ date, ...patch }: { date: string } & Parameters<typeof api.updateDay>[1]) =>
      api.updateDay(date, patch),
    onSuccess: () => invalidateJournal(client),
  });
}

export function useRegenerate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target: { kind: "record"; id: string } | { kind: "day"; date: string }) =>
      target.kind === "record" ? api.regenerateRecord(target.id) : api.regenerateDay(target.date),
    onSuccess: () => {
      // Titles are written by a background job; give it a moment, then refetch.
      setTimeout(() => invalidateJournal(client), 2_500);
    },
  });
}
