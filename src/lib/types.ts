import type { SortDir, SortKey } from "./sortRows.ts";

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

export type BrowserFamily = "chromium" | "firefox" | "other";

export type LinkStatus = "ok" | "gated" | "blocked" | "throttled" | "error" | "dead";

export type LinkReason = "timeout" | "dns" | "refused" | "tls" | "redirects" | "other";

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
  targetBrowser: string | null;
  targetProfile: string | null;
  targetProfileName: string | null;
  linkStatus: LinkStatus | null;
  linkReason: LinkReason | null;
  httpStatus: number | null;
  lastCheckedAt: number | null;
  failCount: number;
}

export interface BrowserProfile {
  key: string;
  name: string;
  avatarFile: string | null;
}

export interface BrowserEntry {
  key: string;
  name: string;
  iconKey: string | null;
  family: BrowserFamily;
  profiles: BrowserProfile[];
}

export interface BrowserTarget {
  browser: string | null;
  profile: string | null;
  profileName: string | null;
}

export interface OpenOutcome {
  missingKind: string | null;
  missingName: string | null;
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

export interface LivenessItem {
  id: number;
  linkStatus: string;
  linkReason: string | null;
  httpStatus: number | null;
  lastCheckedAt: number | null;
  failCount: number;
}

export interface LivenessSweep {
  items: LivenessItem[];
  discarded: boolean;
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
  sortKey: SortKey | null;
  sortDir: SortDir | null;
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

export interface SearchHighlight {
  title: string;
  host: string;
  snippet: string;
  description: string;
  matchedTags: string[];
  matchedInUrl: boolean;
  folderPath: string[];
}

export interface FolderMatch {
  nameHighlighted: string;
  path: string[];
}

export interface SearchResults {
  bookmarks: SearchHit[];
  total: number;
  totalGlobal: number;
  inCurrentFolder: number;
  folders: Folder[];
  highlights: SearchHighlight[];
  folderMatches: FolderMatch[];
}

export interface TagCount {
  name: string;
  count: number;
}

export type Theme = "system" | "light" | "dark";

export type CloseAction = "ask" | "tray" | "quit";

export type LivenessPeriod = "day" | "week" | "month" | "never";

export interface AppSettings {
  theme: Theme;
  closeAction: CloseAction;
  trayNoticeShown: boolean;
  quickAddHotkey: string;
  livenessPeriod: LivenessPeriod;
}
