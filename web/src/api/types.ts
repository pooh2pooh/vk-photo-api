export interface Photo {
  id: number;
  ownerId: number;
  albumId: number;
  width: number;
  height: number;
  text: string;
  date: number;
  thumbnailUrl?: string;
  displayUrl?: string;
}

export interface PhotosPage {
  total: number;
  offset: number;
  count: number;
  hasMore: boolean;
  items: Photo[];
}

export interface SessionState {
  authorized: boolean;
  setupRequired?: boolean;
}

export interface AuthResult {
  authorized: boolean;
}