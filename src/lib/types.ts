export interface Folder {
  id: number;
  parentId: number | null;
  name: string;
  description: string | null;
  image: string | null;
  sort: number;
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
}

export interface FolderContents {
  folders: Folder[];
  bookmarks: Bookmark[];
}
