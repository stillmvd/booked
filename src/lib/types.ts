export interface Folder {
  id: number;
  parentId: number | null;
  name: string;
  description: string | null;
  image: string | null;
  sort: number;
  count: number;
  tags: string[];
}

export interface FolderRef {
  id: number;
  parentId: number | null;
  name: string;
}

export type PreviewOrigin = "og" | "twitter" | "apple-touch" | "favicon" | "host-rule";

export interface Bookmark {
  id: number;
  folderId: number | null;
  title: string;
  url: string;
  urlNormalized: string;
  description: string | null;
  image: string | null;
  previewFile: string | null;
  previewOrigin: PreviewOrigin | null;
  previewFetchedAt: number | null;
  faviconFile: string | null;
  sort: number;
  createdAt: number;
  tags: string[];
}

export interface PreviewInfo {
  file: string | null;
  origin: PreviewOrigin | null;
  title: string | null;
  blocked: boolean;
}

export type MetaInfo = PreviewInfo;

export interface PreviewBackfillItem {
  id: number;
  file: string | null;
  origin: PreviewOrigin | null;
}

export interface DuplicateHit {
  id: number;
  title: string;
  folderId: number | null;
  folderName: string | null;
}

export interface FolderContents {
  folders: Folder[];
  bookmarks: Bookmark[];
}

export interface Crumb {
  id: number;
  name: string;
}

export interface ContentsCount {
  bookmarks: number;
  folders: number;
}

export type DeleteMode = "all" | "promote";

export interface DbStatus {
  ok: boolean;
  path?: string;
  message?: string;
}

export type ViewMode = "tiles" | "list" | "compact";

export interface ViewState {
  mode: ViewMode;
  source: "folder" | "global";
  bandCollapsed: boolean;
  overridesExist: boolean;
}

export interface ClipboardUrl {
  url: string | null;
  hasText: boolean;
}

export interface HotkeyStatus {
  registered: boolean;
  combo: string;
}

export type SearchSort = "relevance" | "date";

export interface SearchRequest {
  text: string;
  tags: string[];
  scopeFolderId: number | null;
  currentFolderId: number | null;
  sort: SearchSort;
  limit: number;
  offset: number;
}

export type SearchHit = Bookmark;

export interface SearchResults {
  bookmarks: SearchHit[];
  total: number;
  totalGlobal: number;
  inCurrentFolder: number;
}
