import { describe, expect, it } from "vitest";
import { baseName, isValidFileName, isValidMode, isValidOwner, joinPath, parentPath } from "../common/protocol";
import { formatSize, permissionsToOctal, sortEntries } from "./format";

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

describe("permissionsToOctal", () => {
  it("reads ls -l permission strings", () => {
    expect(permissionsToOctal("drwxr-xr-x")).toBe("755");
    expect(permissionsToOctal("-rw-r--r--")).toBe("644");
    expect(permissionsToOctal("-rwxr-sr-x")).toBe("2755");
    expect(permissionsToOctal("drwxrwxrwt")).toBe("1777");
    expect(permissionsToOctal("-rwSr--r--")).toBe("4644");
    expect(permissionsToOctal(undefined)).toBeUndefined();
    expect(permissionsToOctal("rwx")).toBeUndefined();
  });
});

describe("isValidMode and isValidOwner", () => {
  it("accept what chmod and chown take and nothing that looks like an option", () => {
    for (const mode of ["644", "0755", "2775", "u+x", "g-w,o-rwx", "a=rX", "+x", "u=rw,go="]) {
      expect(isValidMode(mode), mode).toBe(true);
    }
    for (const mode of ["", "-x", "-R", "888", "12345", "u+x;rm", "u+x y"]) {
      expect(isValidMode(mode), mode).toBe(false);
    }
    for (const owner of ["root", "1000", "app:app", "1000:1000", "www-data:", ":staff", "user.name"]) {
      expect(isValidOwner(owner), owner).toBe(true);
    }
    for (const owner of ["", "-R", "a:-b", "a b", "a:b:c", "$(id)"]) {
      expect(isValidOwner(owner), owner).toBe(false);
    }
  });
});
