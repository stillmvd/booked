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
  targetBrowser: string | null;
  targetProfile: string | null;
  targetProfileName: string | null;
  imageX: number;
  imageY: number;
}

export interface FolderRef {
  id: number;
  parentId: number | null;
  name: string;
}

export interface FolderNode {
  id: number;
  parentId: number | null;
  name: string;
  bookmarkCount: number;
}

export interface FolderTree {
  nodes: FolderNode[];
  rootBookmarkCount: number;
}

export type PreviewOrigin = "og" | "twitter" | "apple-touch" | "favicon" | "host-rule";

export type BrowserFamily = "chromium" | "firefox" | "other";

export type LinkStatus = "ok" | "gated" | "blocked" | "throttled" | "error" | "dead";

export type LinkReason = "timeout" | "dns" | "refused" | "tls" | "redirects" | "other";

export interface BookmarkLink {
  id: number;
  url: string;
  urlNormalized: string;
  label: string | null;
  displayLabel: string;
  platform: string | null;
  linkStatus: LinkStatus | null;
  linkReason: LinkReason | null;
  httpStatus: number | null;
  lastCheckedAt: number | null;
  failCount: number;
}

export interface LinkInput {
  url: string;
  label: string | null;
}

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
  imageX: number;
  imageY: number;
  links: BookmarkLink[];
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

export interface InheritedTarget {
  folderId: number;
  folderName: string;
  target: BrowserTarget;
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

export interface LinkLivenessItem {
  id: number;
  linkStatus: LinkStatus | null;
  linkReason: LinkReason | null;
  httpStatus: number | null;
  lastCheckedAt: number | null;
  failCount: number;
}

export interface LivenessItem extends LinkLivenessItem {
  links: LinkLivenessItem[];
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
  primary: boolean;
}

export type NavTarget = Omit<DuplicateHit, "primary">;

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

export interface TagUsage {
  name: string;
  bookmarks: number;
  folders: number;
  games: number;
}

export type TagTarget = { kind: "bookmark" | "folder" | "game"; id: number };

export interface TagRenameOutcome {
  name: string;
  merged: boolean;
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
  privateImages: boolean;
}

export interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface BackupSummary {
  folders: number;
  bookmarks: number;
  exportedAt: number;
}

export type ImportMode = "replace" | "merge";

export interface ImportApplied {
  folders: number;
  bookmarks: number;
}

export interface ImportInspection {
  ok: boolean;
  fileName: string | null;
  summary: BackupSummary | null;
  currentFolders: number | null;
  currentBookmarks: number | null;
  error: string | null;
}

export type GameStatus = "new" | "playing" | "finished" | "dropped";

export type GameSource = "f95" | "itch";

export interface Game {
  id: number;
  baseName: string;
  title: string;
  folderPath: string | null;
  folderName: string | null;
  versionInstalled: string | null;
  versionSource: "folder" | "manual";
  source: GameSource | null;
  engine: string | null;
  pageUrl: string | null;
  image: string | null;
  imageX: number;
  imageY: number;
  status: GameStatus;
  rating: number;
  exePath: string | null;
  exeSource: "auto" | "manual";
  sizeBytes: number | null;
  lastLaunchedAt: number | null;
  siteVersion: string | null;
  seenVersion: string | null;
  skippedVersion: string | null;
  lastCheckedAt: number | null;
  tags: string[];
  hasUpdate: boolean;
}

export interface GameMatchReasons {
  name: boolean;
  page: GameSource | null;
  exe: string | null;
  engine: string | null;
}

export interface GameVersionGroup {
  ids: number[];
  reasons: GameMatchReasons;
}

export interface GamesLibrary {
  root: string | null;
  rootAvailable: boolean;
  games: Game[];
  versions: GameVersionGroup[];
}

export interface GameMergeFolder {
  id: number;
  sizeBytes: number;
  modified: number | null;
  saves: number;
}

export interface GameMergePreview {
  ids: number[];
  reasons: GameMatchReasons | null;
  keptId: number | null;
  folders: GameMergeFolder[];
}

export type GameMergeOutcome =
  | { kind: "done"; id: number }
  | { kind: "needsPermanent"; folder: string; path: string; bytes: number };
