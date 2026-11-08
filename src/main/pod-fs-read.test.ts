import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EDITABLE_FILE_SIZE } from "../common/protocol";

// The read script answers with the size of the file and its first `limit` bytes; the fake does the same from memory
// and records the limits it was asked for.
const files = new Map<string, Buffer>();
const limits: number[] = [];

vi.mock("./kubectl", async (importOriginal) => {
  const original = await importOriginal<typeof import("./kubectl")>();
  return {
    ...original,
    runKubectl: vi.fn(async (_clusterId: string, args: string[]) => {
      const [path, limit] = args.slice(-2);
      const data = files.get(path) ?? Buffer.alloc(0);
      limits.push(Number(limit));
      return {
        stdout: Buffer.concat([Buffer.from(`${data.length}\n`), data.subarray(0, Number(limit))]),
        stderr: "",
        code: 0,
      };
    }),
  };
});

const { PodFileSystem } = await import("./pod-fs");
const fs = new PodFileSystem(".");
const target = { clusterId: "c", namespace: "n", pod: "p", container: "c" };

beforeEach(() => {
  files.clear();
  limits.length = 0;
});

describe("PodFileSystem.readFile", () => {
  it("reads a large binary file no further than its first bytes", async () => {
    const binary = Buffer.alloc(50 * 1024 * 1024);
    binary.write("\x7fELF", 0, "latin1");
    files.set("/bin/app", binary);

    const file = await fs.readFile(target, "/bin/app", undefined);

    expect(file).toMatchObject({ binary: true, truncated: true, content: "", lossless: false, size: binary.length });
    expect(limits).toEqual([8192]);
  });

  it("reads a small text file at once, as UTF-8", async () => {
    files.set("/etc/motd", Buffer.from("Ahoj světe\n", "utf8"));

    const file = await fs.readFile(target, "/etc/motd", undefined);

    expect(file).toMatchObject({ binary: false, truncated: false, lossless: true, encoding: "utf8" });
    expect(file.content).toBe("Ahoj světe\n");
    expect(limits).toEqual([8192]);
  });

  it("reads a longer text file up to the limit and marks a larger one as truncated", async () => {
    files.set("/var/log/big.log", Buffer.alloc(MAX_EDITABLE_FILE_SIZE + 10, "a"));

    const file = await fs.readFile(target, "/var/log/big.log", undefined);

    expect(file).toMatchObject({ binary: false, truncated: true, lossless: false });
    expect(file.content.length).toBe(MAX_EDITABLE_FILE_SIZE);
    expect(limits).toEqual([8192, MAX_EDITABLE_FILE_SIZE + 1]);
  });

  it("opens text that is not UTF-8 read only, and editable in its encoding", async () => {
    files.set("/data/cz.txt", Buffer.from([0x50, 0xf8, 0xed, 0x6c, 0x69, 0x9a]));

    expect(await fs.readFile(target, "/data/cz.txt", undefined)).toMatchObject({ encoding: "utf8", lossless: false });
    expect(await fs.readFile(target, "/data/cz.txt", "windows1250")).toMatchObject({
      encoding: "windows1250",
      lossless: true,
      content: "Příliš",
    });
  });

  it("shows a binary file as text when an encoding is asked for, never editable", async () => {
    files.set("/data/blob", Buffer.from([0x41, 0x00, 0x42]));

    const file = await fs.readFile(target, "/data/blob", "iso88591");

    expect(file).toMatchObject({ binary: true, lossless: false, content: "A\u0000B" });
  });
});
