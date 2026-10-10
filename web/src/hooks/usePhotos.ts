import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPhotos } from "../api/client.js";
import { getConfig } from "../api/config.js";

export function usePageSize(): number {
  return getConfig().pageSize ?? 30;
}

export function usePhotos(page: number) {
  const count = usePageSize();
  const offset = (page - 1) * count;

  return useQuery({
    queryKey: ["photos", { offset, count }],
    queryFn: ({ signal }) => fetchPhotos({ offset, count, signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
  });
}
