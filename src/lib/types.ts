export interface Folder {
  id: number;
  parentId: number | null;
  name: string;
  description: string | null;
  image: string | null;
  sort: number;
  tags: string[];
}

export interface FolderRef {
  id: number;
  parentId: number | null;
  name: string;
}

export interface Bookmark {
  id: number;
  folderId: number | null;
  title: string;
  url: string;
  urlNormalized: string;
  description: string | null;
  image: string | null;
  sort: number;
  tags: string[];
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
