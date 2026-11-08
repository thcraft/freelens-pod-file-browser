export const IpcChannel = {
  listPods: "list-pods",
  listDirectory: "list-directory",
  readFile: "read-file",
  writeFile: "write-file",
  uploadData: "upload-data",
  pickUploadFiles: "pick-upload-files",
  uploadFiles: "upload-files",
  download: "download",
  makeDirectory: "make-directory",
  createFile: "create-file",
  rename: "rename",
  remove: "remove",
} as const;

export interface PodTarget {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
}

export interface PodContainerInfo {
  name: string;
  running: boolean;
  init: boolean;
}

export interface PodInfo {
  name: string;
  phase: string;
  containers: PodContainerInfo[];
}

export type FileEntryKind = "file" | "directory" | "symlink" | "other";

export interface FileEntry {
  name: string;
  kind: FileEntryKind;
  /** For a symlink: whether it resolves to a directory. */
  targetIsDirectory: boolean;
  linkTarget?: string;
  size?: number;
  /** Seconds since the epoch. */
  modified?: number;
  permissions?: string;
  owner?: string;
  group?: string;
}

export interface DirectoryListing {
  /** The absolute path the shell resolved the requested one to. */
  path: string;
  entries: FileEntry[];
  /** False when the container has no `stat`, so sizes and times are missing. */
  hasDetails: boolean;
}

export interface FileContent {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content: string;
}

export interface DownloadItem {
  path: string;
  isDirectory: boolean;
}

export interface DownloadResult {
  /** Local files written; empty when the user cancelled the dialog. */
  saved: string[];
}

export interface UploadResult {
  uploaded: string[];
}

/** A file on the user's machine, picked in the main process's open dialog. */
export interface LocalFile {
  path: string;
  name: string;
}

/** Errors cross IPC as plain messages; the renderer shows them as they are. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_EDITABLE_FILE_SIZE = 2 * 1024 * 1024;
export const MAX_DROP_UPLOAD_SIZE = 256 * 1024 * 1024;

export function joinPath(directory: string, name: string): string {
  if (directory === "" || directory === "/") {
    return `/${name}`;
  }
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return trimmed.slice(0, index);
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || "/";
}

export function isValidFileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0");
}
