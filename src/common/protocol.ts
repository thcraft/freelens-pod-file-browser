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
  updateStatus: "update-status",
  checkForUpdates: "check-for-updates",
  installUpdate: "install-update",
  transferProgress: "transfer-progress",
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

/** The text encodings the editor offers, by their iconv-lite names. */
export const TEXT_ENCODINGS = [
  { id: "utf8", label: "UTF-8" },
  { id: "windows1250", label: "Windows-1250 (Central European)" },
  { id: "iso88592", label: "ISO-8859-2 (Latin-2)" },
  { id: "cp852", label: "CP852 (DOS Central European)" },
  { id: "windows1252", label: "Windows-1252 (Western)" },
  { id: "iso88591", label: "ISO-8859-1 (Latin-1)" },
  { id: "iso885915", label: "ISO-8859-15 (Latin-9)" },
  { id: "windows1251", label: "Windows-1251 (Cyrillic)" },
  { id: "koi8r", label: "KOI8-R" },
  { id: "utf16le", label: "UTF-16 LE" },
  { id: "utf16be", label: "UTF-16 BE" },
] as const;

export type TextEncoding = (typeof TEXT_ENCODINGS)[number]["id"];

export function isTextEncoding(value: unknown): value is TextEncoding {
  return TEXT_ENCODINGS.some((encoding) => encoding.id === value);
}

export interface FileContent {
  path: string;
  size: number;
  /** The file is larger than what was read; the editor shows it read only. */
  truncated: boolean;
  /**
   * The file has NUL bytes and is not UTF-16. It is never editable; its content is read and shown only when an
   * encoding was asked for, so that opening a large binary file by mistake reads no more than its first bytes.
   */
  binary: boolean;
  /** The encoding the content was decoded with: the one asked for, or UTF-8 (UTF-16 with its byte order mark). */
  encoding: TextEncoding;
  /**
   * The content encodes back to exactly the bytes read. When it does not, saving would change bytes the user did not
   * edit, so the editor shows the file read only.
   */
  lossless: boolean;
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

/** Broadcast by main while a file downloads, after every chunk. */
export interface TransferProgressEvent {
  /** The transfer, as the renderer that started it named it. */
  id: string;
  path: string;
  done: number;
  total: number;
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
