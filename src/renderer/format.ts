import type { FileEntry } from "../common/protocol";

const units = ["B", "KiB", "MiB", "GiB", "TiB"];

export function formatSize(size: number | undefined): string {
  if (size === undefined || Number.isNaN(size)) {
    return "";
  }
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return "";
  }
  return new Date(seconds * 1000).toLocaleString();
}

export function isDirectoryLike(entry: FileEntry): boolean {
  return entry.kind === "directory" || (entry.kind === "symlink" && entry.targetIsDirectory);
}

export type SortColumn = "name" | "size" | "modified";

export function sortEntries(entries: FileEntry[], column: SortColumn, descending: boolean): FileEntry[] {
  const direction = descending ? -1 : 1;
  const value = (entry: FileEntry) =>
    column === "size" ? (entry.size ?? -1) : column === "modified" ? (entry.modified ?? 0) : 0;

  return [...entries].sort((a, b) => {
    const directories = Number(isDirectoryLike(b)) - Number(isDirectoryLike(a));
    if (directories !== 0) {
      return directories;
    }
    const byValue = value(a) - value(b);
    if (byValue !== 0) {
      return byValue * direction;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * direction;
  });
}

export function editorLanguageFor(path: string): "yaml" | "json" | undefined {
  if (/\.ya?ml$/i.test(path)) {
    return "yaml";
  }
  if (/\.json$/i.test(path)) {
    return "json";
  }
  return undefined;
}
