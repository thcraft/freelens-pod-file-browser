export const IpcChannel = {
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
  setAttributes: "set-attributes",
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

export interface FileAttributes {
  /** An octal mode such as 644 or 2755, or a symbolic one such as u+x,g-w. */
  mode?: string;
  /** user, user:group or :group, by name or numeric id. */
  owner?: string;
  recursive: boolean;
}

const OCTAL_MODE = /^[0-7]{3,4}$/;
const SYMBOLIC_CLAUSE = "[ugoa]*([-+=][rwxXst]*)+";
const SYMBOLIC_MODE = new RegExp(`^${SYMBOLIC_CLAUSE}(,${SYMBOLIC_CLAUSE})*$`);
const OWNER_NAME = "[A-Za-z0-9._][A-Za-z0-9._-]*";
const OWNER = new RegExp(`^(${OWNER_NAME}(:(${OWNER_NAME})?)?|:${OWNER_NAME})$`);

/** A mode chmod takes; never one that starts with "-", which chmod would read as an option. */
export function isValidMode(mode: string): boolean {
  return OCTAL_MODE.test(mode) || (SYMBOLIC_MODE.test(mode) && !mode.startsWith("-"));
}

/** user, user:group, user: or :group; never one that starts with "-". */
export function isValidOwner(owner: string): boolean {
  return OWNER.test(owner);
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
