import { describe, expect, it } from "vitest";
import { parseListing } from "./pod-fs";

describe("parseListing", () => {
  it("merges the entries with their stat details", () => {
    const output = [
      "P//var/log",
      "E/d/nginx/",
      "E/f/.hidden/",
      "E/lf/current/nginx/access.log",
      "E/ld/link-dir/../lib",
      "E/o/fifo/",
      "H/",
      "S/4096/1700000000/drwxr-xr-x/root/root/nginx",
      "S/12/1700000001/-rw-r--r--/app/staff/.hidden",
      "S/16/1700000002/lrwxrwxrwx/root/root/current",
      "",
    ].join("\n");

    const listing = parseListing(output, "/var/log/");

    expect(listing.path).toBe("/var/log");
    expect(listing.hasDetails).toBe(true);
    expect(listing.entries).toEqual([
      {
        name: "nginx",
        kind: "directory",
        targetIsDirectory: true,
        linkTarget: undefined,
        size: 4096,
        modified: 1700000000,
        permissions: "drwxr-xr-x",
        owner: "root",
        group: "root",
      },
      {
        name: ".hidden",
        kind: "file",
        targetIsDirectory: false,
        linkTarget: undefined,
        size: 12,
        modified: 1700000001,
        permissions: "-rw-r--r--",
        owner: "app",
        group: "staff",
      },
      {
        name: "current",
        kind: "symlink",
        targetIsDirectory: false,
        linkTarget: "nginx/access.log",
        size: 16,
        modified: 1700000002,
        permissions: "lrwxrwxrwx",
        owner: "root",
        group: "root",
      },
      { name: "link-dir", kind: "symlink", targetIsDirectory: true, linkTarget: "../lib" },
      { name: "fifo", kind: "other", targetIsDirectory: false, linkTarget: undefined },
    ]);
  });

  it("keeps the requested path and reports no details without stat", () => {
    const listing = parseListing("E/f/a b c/\nbroken line\n", "/data");

    expect(listing.path).toBe("/data");
    expect(listing.hasDetails).toBe(false);
    expect(listing.entries).toEqual([{ name: "a b c", kind: "file", targetIsDirectory: false, linkTarget: undefined }]);
  });
});
