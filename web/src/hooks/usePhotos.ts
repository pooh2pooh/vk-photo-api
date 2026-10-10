import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPhotos } from "../api/client.js";

export const PAGE_SIZE = 30;

export function usePhotos(page: number) {
  const offset = (page - 1) * PAGE_SIZE;

  return useQuery({
    queryKey: ["photos", { offset, count: PAGE_SIZE }],
    queryFn: ({ signal }) => fetchPhotos({ offset, count: PAGE_SIZE, signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
  });
}
