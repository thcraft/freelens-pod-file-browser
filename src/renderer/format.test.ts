import { describe, expect, it } from "vitest";
import { baseName, isValidFileName, joinPath, parentPath } from "../common/protocol";
import { formatSize, sortEntries } from "./format";

describe("paths", () => {
  it("joins, splits and validates container paths", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("/var/log/", "a.log")).toBe("/var/log/a.log");
    expect(parentPath("/var/log")).toBe("/var");
    expect(parentPath("/var")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(baseName("/var/log/")).toBe("log");
    expect(isValidFileName("a.txt")).toBe(true);
    expect(isValidFileName("..")).toBe(false);
    expect(isValidFileName("a/b")).toBe(false);
  });
});

describe("formatSize", () => {
  it("uses binary units", () => {
    expect(formatSize(undefined)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KiB");
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MiB");
  });
});

describe("sortEntries", () => {
  it("lists directories first, then sorts by the column", () => {
    const entries = [
      { name: "b.txt", kind: "file" as const, targetIsDirectory: false, size: 1 },
      { name: "z", kind: "directory" as const, targetIsDirectory: true },
      { name: "a.txt", kind: "file" as const, targetIsDirectory: false, size: 3 },
      { name: "lib", kind: "symlink" as const, targetIsDirectory: true },
    ];

    expect(sortEntries(entries, "name", false).map((e) => e.name)).toEqual(["lib", "z", "a.txt", "b.txt"]);
    expect(sortEntries(entries, "size", true).map((e) => e.name)).toEqual(["z", "lib", "a.txt", "b.txt"]);
  });
});
