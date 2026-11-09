import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunOptions } from "./kubectl";

// The container: one file, read by FILE_INFO_SCRIPT (size and "dd") and CHUNK_SCRIPT (blocks of 64 KiB). The fake
// kubectl answers both from memory and can break the WebSocket stream of chosen calls, as a proxy does.
const BLOCK = 64 * 1024;
let file = Buffer.alloc(0);
let breakCalls = new Set<number>();
let calls: { kind: "info" | "chunk"; websockets: boolean | undefined }[] = [];

vi.mock("./kubectl", async (importOriginal) => {
  const original = await importOriginal<typeof import("./kubectl")>();
  return {
    ...original,
    runKubectl: vi.fn(async (_clusterId: string, args: string[], options: RunOptions) => {
      const script = args[args.indexOf("-c") + 1];
      const index = calls.length;
      if (script.includes("command -v dd")) {
        calls.push({ kind: "info", websockets: options.websockets });
        return { stdout: Buffer.from(`${file.length} dd\n`), stderr: "", code: 0 };
      }
      calls.push({ kind: "chunk", websockets: options.websockets });
      if (breakCalls.has(index)) {
        return {
          stdout: Buffer.alloc(0),
          stderr:
            'E1109 v2.go:167] "Unhandled Error" err="read message: %!w(<nil>)"\nerror: error reading from error stream: read message: %!w(<nil>)',
          code: 1,
        };
      }
      const [skip, count] = args.slice(-2).map(Number);
      return { stdout: file.subarray(skip * BLOCK, (skip + count) * BLOCK), stderr: "", code: 0 };
    }),
  };
});

const { PodFileSystem } = await import("./pod-fs");
const kubectl = await import("./kubectl");

let dir: string;
let cluster = 0;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pod-fs-download-"));
  // A cluster of its own for every test, so that the SPDY the module remembers does not carry over.
  cluster++;
  breakCalls = new Set();
  calls = [];
  file = Buffer.from(Array.from({ length: 20 * 1024 * 1024 + 123 }, (_, i) => (i * 31 + 7) % 251));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function target() {
  return { clusterId: `cluster-${cluster}`, namespace: "n", pod: "p", container: "c" };
}

describe("PodFileSystem.downloadFile", () => {
  it("downloads a large file in chunks of 8 MiB and reports the progress", async () => {
    const local = path.join(dir, "app.dmg");
    const progress: number[] = [];

    await new PodFileSystem(".").downloadFile(target(), "/var/app.dmg", local, (done) => progress.push(done));

    expect(readFileSync(local).equals(file)).toBe(true);
    expect(calls.map((call) => call.kind)).toEqual(["info", "chunk", "chunk", "chunk"]);
    expect(progress).toEqual([0, 8 * 1024 * 1024, 16 * 1024 * 1024, file.length]);
    expect(readdirSync(dir)).toEqual(["app.dmg"]);
  });

  it("reads a chunk again over SPDY when its WebSocket stream breaks off, and keeps SPDY for the cluster", async () => {
    const local = path.join(dir, "app.dmg");
    breakCalls = new Set([2]);

    await new PodFileSystem(".").downloadFile(target(), "/var/app.dmg", local);

    expect(readFileSync(local).equals(file)).toBe(true);
    expect(calls.map((call) => call.websockets)).toEqual([undefined, undefined, undefined, false, undefined]);
    expect(kubectl.prefersSpdy(target().clusterId)).toBe(true);
  });

  it("gives up after the chunk failed every time, and leaves no file behind", async () => {
    const local = path.join(dir, "app.dmg");
    breakCalls = new Set(Array.from({ length: 20 }, (_, i) => i + 1));

    await expect(new PodFileSystem(".").downloadFile(target(), "/var/app.dmg", local)).rejects.toThrow(
      /error reading from error stream/,
    );

    expect(readdirSync(dir)).toEqual([]);
  });

  it("downloads an empty file", async () => {
    const local = path.join(dir, "empty");
    file = Buffer.alloc(0);

    await new PodFileSystem(".").downloadFile(target(), "/var/empty", local);

    expect(readFileSync(local).length).toBe(0);
    expect(calls.map((call) => call.kind)).toEqual(["info"]);
  });
});
