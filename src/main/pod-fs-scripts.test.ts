import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATTRIBUTES_SCRIPT, CREATE_FILE_SCRIPT, LIST_SCRIPT, parseListing, READ_SCRIPT, RENAME_SCRIPT } from "./pod-fs";

// The scripts run in the container through `sh -c`. Here they run in the
// local POSIX shell, when there is one, with the same positional parameters.
const hasShell = spawnSync("sh", ["-c", "exit 0"]).status === 0;

function sh(script: string, args: string[]) {
  const result = spawnSync("sh", ["-c", script, "sh", ...args]);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr.toString("utf8") };
}

describe.skipIf(!hasShell)("the container scripts", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "pod-fs-")).replaceAll("\\", "/");
    mkdirSync(path.join(root, "dir with space"));
    writeFileSync(path.join(root, ".hidden"), "secret");
    writeFileSync(path.join(root, "-dash.txt"), "dash");
    writeFileSync(path.join(root, "data.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(root, "big.txt"), "x".repeat(100));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists a directory with hidden files, odd names and details", () => {
    const result = sh(LIST_SCRIPT, [root]);
    expect(result.code).toBe(0);

    const listing = parseListing(result.stdout.toString("utf8"), root);
    const byName = Object.fromEntries(listing.entries.map((entry) => [entry.name, entry]));

    expect(Object.keys(byName).sort()).toEqual(["-dash.txt", ".hidden", "big.txt", "data.bin", "dir with space"]);
    expect(byName["dir with space"].kind).toBe("directory");
    expect(byName[".hidden"].kind).toBe("file");
    expect(listing.path.endsWith(path.basename(root))).toBe(true);
    if (listing.hasDetails) {
      expect(byName["big.txt"].size).toBe(100);
      expect(byName["-dash.txt"].permissions).toMatch(/^-/);
    }
  });

  it("lists an empty directory", () => {
    const result = sh(LIST_SCRIPT, [`${root}/dir with space`]);
    expect(result.code).toBe(0);
    expect(parseListing(result.stdout.toString("utf8"), "").entries).toEqual([]);
  });

  it("fails on a directory that does not exist", () => {
    expect(sh(LIST_SCRIPT, [`${root}/missing`]).code).not.toBe(0);
  });

  it("reads the size and the first bytes of a file", () => {
    const result = sh(READ_SCRIPT, [`${root}/big.txt`, "10"]);
    expect(result.code).toBe(0);
    expect(result.stdout.toString("utf8")).toBe(`100\n${"x".repeat(10)}`);
  });

  it("refuses to read a directory", () => {
    const result = sh(READ_SCRIPT, [`${root}/dir with space`, "10"]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("not a regular file");
  });

  it("creates a file once and renames without overwriting", () => {
    expect(sh(CREATE_FILE_SCRIPT, [`${root}/new.txt`]).code).toBe(0);
    expect(sh(CREATE_FILE_SCRIPT, [`${root}/new.txt`]).code).toBe(5);
    expect(sh(RENAME_SCRIPT, [`${root}/new.txt`, `${root}/big.txt`]).code).toBe(5);
    expect(readFileSync(path.join(root, "big.txt"), "utf8")).toBe("x".repeat(100));
    expect(sh(RENAME_SCRIPT, [`${root}/new.txt`, `${root}/renamed.txt`]).code).toBe(0);
    expect(readFileSync(path.join(root, "renamed.txt"), "utf8")).toBe("");
  });

  // The POSIX shells of Windows, such as Git Bash, keep no mode bits on NTFS.
  it.skipIf(process.platform === "win32")("changes the mode of the given paths, recursively when asked", () => {
    mkdirSync(path.join(root, "tree/sub"), { recursive: true });
    writeFileSync(path.join(root, "tree/sub/file"), "");
    const mode = (file: string) =>
      spawnSync("stat", ["-c", "%a", `${root}/${file}`])
        .stdout.toString("utf8")
        .trim();

    expect(sh(ATTRIBUTES_SCRIPT, ["0", "", "700", `${root}/tree`]).code).toBe(0);
    expect(mode("tree")).toBe("700");
    expect(sh(ATTRIBUTES_SCRIPT, ["1", "", "u=rwx,go=rx", `${root}/tree`]).code).toBe(0);
    expect(mode("tree/sub")).toBe("755");
  });

  it("fails with the message of chown", () => {
    const result = sh(ATTRIBUTES_SCRIPT, ["0", "no-such-user-xyz", "", `${root}/big.txt`]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/no-such-user-xyz|invalid/i);
  });
});
