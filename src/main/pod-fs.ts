import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  baseName,
  type DirectoryListing,
  type FileAttributes,
  type FileContent,
  type FileEntry,
  type FileEntryKind,
  isValidMode,
  isValidOwner,
  MAX_EDITABLE_FILE_SIZE,
  type PodTarget,
  parentPath,
  type TextEncoding,
} from "../common/protocol";
import { decodeText, defaultEncoding, encodeText, looksBinary } from "./encoding";
import {
  describeFailure,
  execArgs,
  isStreamFailure,
  preferSpdy,
  prefersSpdy,
  RemoteError,
  type RunOptions,
  type RunResult,
  runKubectl,
  shellCommand,
} from "./kubectl";

const QUICK_TIMEOUT_MS = 60_000;
// Enough to tell a binary file by its NUL bytes; most binary formats have some in their header.
const SNIFF_SIZE = 8192;

// Every script is POSIX sh that runs on BusyBox as well as on a full
// userland. Paths reach a script only as positional parameters.

// Output, one record per line, fields separated by "/", which no file name
// contains:
//   P/<absolute path of the directory>
//   E/<f|d|lf|ld|o>/<name>/<symlink target>
//   H/                        (stat is available, S lines follow)
//   S/<size>/<mtime>/<permissions>/<owner>/<group>/<name>
export const LIST_SCRIPT = `
cd -- "\${1:-.}" || exit 3
printf 'P/%s\\n' "$(pwd)"
for f in .[!.]* ..?* *; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  if [ -L "$f" ]; then
    if [ -d "$f" ]; then k=ld; else k=lf; fi
    printf 'E/%s/%s/%s\\n' "$k" "$f" "$(readlink -- "$f" 2>/dev/null)"
  elif [ -d "$f" ]; then printf 'E/d/%s/\\n' "$f"
  elif [ -f "$f" ]; then printf 'E/f/%s/\\n' "$f"
  else printf 'E/o/%s/\\n' "$f"
  fi
done
if command -v stat >/dev/null 2>&1; then
  echo 'H/'
  set --
  for f in .[!.]* ..?* *; do
    if [ -e "$f" ] || [ -L "$f" ]; then set -- "$@" "$f"; fi
  done
  if [ $# -gt 0 ]; then stat -c 'S/%s/%Y/%A/%U/%G/%n' -- "$@" 2>/dev/null; fi
fi
exit 0
`;

// The first line is the size of the whole file, the rest its first $2 bytes.
export const READ_SCRIPT = `
[ -f "$1" ] || { echo "not a regular file: $1" >&2; exit 4; }
[ -r "$1" ] || { echo "permission denied: $1" >&2; exit 4; }
s=$(stat -c %s -- "$1" 2>/dev/null) || s=$(wc -c < "$1")
printf '%s\\n' "$s"
head -c "$2" "$1"
`;

// $1: the file, $2: the number of bytes on stdin. The data goes to a temporary file next to the target first, and
// replaces the content of the target only when all of it arrived: a transfer that breaks off ends stdin early, and
// the target keeps its content. Writing into the target, rather than renaming over it, keeps its owner, mode and
// links. A directory that takes no new file gets the data written into the target directly, checked afterwards.
export const WRITE_SCRIPT = `
f=$1; n=$2
t=$(mktemp "\${f%/*}/.pod-file-browser.XXXXXX" 2>/dev/null) || t=
if [ -z "$t" ]; then
  cat > "$f" || exit $?
  s=$(( $(wc -c < "$f") ))
  [ "$s" -eq "$n" ] || { echo "the transfer broke off: $s of $n bytes were written" >&2; exit 6; }
  exit 0
fi
trap 'rm -f -- "$t"' EXIT
cat > "$t" || exit $?
s=$(( $(wc -c < "$t") ))
[ "$s" -eq "$n" ] || { echo "the transfer broke off: $s of $n bytes arrived; $f is unchanged" >&2; exit 6; }
cat -- "$t" > "$f"
`;
// The check gives a readable message; noclobber (set -C) makes the creation itself fail on a file that appeared
// meanwhile.
export const CREATE_FILE_SCRIPT = `if [ -e "$1" ] || [ -L "$1" ]; then echo "already exists: $1" >&2; exit 5; fi; set -C; : > "$1"`;
const MAKE_DIRECTORY_SCRIPT = `mkdir -- "$1"`;
export const RENAME_SCRIPT = `if [ -e "$2" ] || [ -L "$2" ]; then echo "already exists: $2" >&2; exit 5; fi; mv -- "$1" "$2"`;
const REMOVE_SCRIPT = `rm -rf -- "$@"`;
// $1: 1 for recursive, $2: owner (or empty), $3: mode (or empty), then the paths.
// The owner goes first, because chown may clear the set-id bits that chmod sets.
export const ATTRIBUTES_SCRIPT = `
r=$1; owner=$2; mode=$3; shift 3
if [ -n "$owner" ]; then
  if [ "$r" = 1 ]; then chown -R "$owner" "$@" || exit $?; else chown "$owner" "$@" || exit $?; fi
fi
if [ -n "$mode" ]; then
  if [ "$r" = 1 ]; then chmod -R "$mode" "$@"; else chmod "$mode" "$@"; fi
fi
`;
const CAT_SCRIPT = `cat -- "$1"`;
// The size of a regular file, and "dd" when the container has it for reading the file in chunks.
export const FILE_INFO_SCRIPT = `
[ -f "$1" ] || { echo "not a regular file: $1" >&2; exit 4; }
[ -r "$1" ] || { echo "permission denied: $1" >&2; exit 4; }
s=$(stat -c %s -- "$1" 2>/dev/null) || s=$(wc -c < "$1")
if command -v dd >/dev/null 2>&1; then d=dd; else d=-; fi
printf '%s %s\\n' "$s" "$d"
`;
const CHUNK_BLOCK_SIZE = 64 * 1024;
const CHUNK_SIZE = 8 * 1024 * 1024;
const CHUNK_ATTEMPTS = 3;
const CHUNK_TIMEOUT_MS = 5 * 60_000;
// $1: the file, $2: the first block, $3: the number of blocks, in blocks of CHUNK_BLOCK_SIZE bytes.
export const CHUNK_SCRIPT = `dd if="$1" bs=${CHUNK_BLOCK_SIZE} skip="$2" count="$3" 2>/dev/null`;

/** Bytes done of the total, after every chunk of a download. */
export type TransferProgress = (done: number, total: number) => void;
// $1: the parent directory, $2: the name. A symlink to a directory is followed (cd -P), so that the archive holds
// the directory it points to, under that directory's own name.
export const TAR_SCRIPT = `cd -- "$1" && cd -P -- "$2" && n=$(pwd -P) && cd .. && tar cf - "./\${n##*/}"`;

const kindByCode: Record<string, FileEntryKind> = {
  f: "file",
  d: "directory",
  lf: "symlink",
  ld: "symlink",
  o: "other",
};

function splitFields(line: string, count: number): string[] | undefined {
  const fields: string[] = [];
  let rest = line;
  for (let i = 0; i < count - 1; i++) {
    const index = rest.indexOf("/");
    if (index < 0) {
      return undefined;
    }
    fields.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
  }
  fields.push(rest);
  return fields;
}

export function parseListing(output: string, requestedPath: string): DirectoryListing {
  let path = requestedPath;
  let hasDetails = false;
  const entries = new Map<string, FileEntry>();
  const details: string[][] = [];

  for (const line of output.split("\n")) {
    const fields = splitFields(line, 2);
    if (!fields) {
      continue;
    }
    const [type, rest] = fields;
    if (type === "P") {
      path = rest;
    } else if (type === "H") {
      hasDetails = true;
    } else if (type === "E") {
      const entry = splitFields(rest, 3);
      const kind = entry && kindByCode[entry[0]];
      if (entry && kind && entry[1] !== "") {
        entries.set(entry[1], {
          name: entry[1],
          kind,
          targetIsDirectory: entry[0] === "d" || entry[0] === "ld",
          linkTarget: kind === "symlink" ? entry[2] : undefined,
        });
      }
    } else if (type === "S") {
      const detail = splitFields(rest, 6);
      if (detail) {
        details.push(detail);
      }
    }
  }

  for (const [size, modified, permissions, owner, group, name] of details) {
    const entry = entries.get(name);
    if (entry) {
      entry.size = Number(size);
      entry.modified = Number(modified);
      entry.permissions = permissions;
      entry.owner = owner;
      entry.group = group;
    }
  }

  return { path, entries: [...entries.values()], hasDetails };
}

export class PodFileSystem {
  constructor(private readonly cwd: string) {}

  // Listing, reading, renaming and the like answer within seconds; a minute is a hung exec or API server. Deleting
  // and changing a whole tree take as long as the tree needs, so they pass no timeout.
  private async exec(
    target: PodTarget,
    script: string,
    args: string[],
    action: string,
    timeoutMs: number | undefined = QUICK_TIMEOUT_MS,
  ) {
    const result = await runKubectl(target.clusterId, execArgs(target, shellCommand(script, args)), {
      cwd: this.cwd,
      timeoutMs,
    });
    if (result.code !== 0) {
      throw describeFailure(result, action);
    }
    return result.stdout;
  }

  async listDirectory(target: PodTarget, path: string): Promise<DirectoryListing> {
    const output = await this.exec(target, LIST_SCRIPT, [path], `Cannot open ${path || "the working directory"}`);
    return parseListing(output.toString("utf8"), path);
  }

  /** The size of the file and its first `limit` bytes. */
  private async readStart(target: PodTarget, path: string, limit: number) {
    const result = await this.transfer(
      target,
      execArgs(target, shellCommand(READ_SCRIPT, [path, String(limit)])),
      () => ({
        cwd: this.cwd,
        timeoutMs: QUICK_TIMEOUT_MS,
      }),
    );
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot read ${path}`);
    }
    const output = result.stdout;
    const newline = output.indexOf(0x0a);
    return {
      size: Number(output.subarray(0, newline).toString("utf8").trim()),
      data: output.subarray(newline + 1),
    };
  }

  /**
   * The first SNIFF_SIZE bytes tell a binary file, which is then not read further unless an encoding is asked for.
   * A text file is read up to MAX_EDITABLE_FILE_SIZE bytes, plus one to tell a file that grew since its size was read
   * from one that fits. Without `encoding` it is decoded as UTF-8, or as UTF-16 by its byte order mark.
   */
  async readFile(target: PodTarget, path: string, encoding: TextEncoding | undefined): Promise<FileContent> {
    let { size, data } = await this.readStart(target, path, SNIFF_SIZE);
    const chosen = encoding ?? defaultEncoding(data);
    const binaryContent = (length: number): FileContent => ({
      path,
      size,
      truncated: size > length,
      binary: true,
      encoding: chosen,
      lossless: false,
      content: "",
    });

    if (!encoding && looksBinary(data, chosen)) {
      return binaryContent(data.length);
    }
    if (data.length >= SNIFF_SIZE || size > data.length) {
      ({ size, data } = await this.readStart(target, path, MAX_EDITABLE_FILE_SIZE + 1));
    }
    const truncated = data.length > MAX_EDITABLE_FILE_SIZE || size > data.length;
    data = data.subarray(0, MAX_EDITABLE_FILE_SIZE);
    const binary = looksBinary(data, chosen);
    if (!encoding && binary) {
      return binaryContent(data.length);
    }

    const { content, lossless } = decodeText(data, chosen);
    return { path, size, truncated, binary, encoding: chosen, lossless: lossless && !truncated && !binary, content };
  }

  async writeText(target: PodTarget, path: string, content: string, encoding: TextEncoding) {
    await this.writeBytes(target, path, encodeText(content, encoding));
  }

  async writeBytes(target: PodTarget, path: string, data: Uint8Array) {
    const result = await this.transfer(
      target,
      execArgs(target, shellCommand(WRITE_SCRIPT, [path, String(data.byteLength)]), true),
      () => ({ cwd: this.cwd, input: data }),
    );
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot write ${path}`);
    }
  }

  async uploadLocalFile(target: PodTarget, localPath: string, remotePath: string) {
    const info = await stat(localPath);
    if (!info.isFile()) {
      throw new RemoteError(`${localPath} is not a file`);
    }
    const result = await this.transfer(
      target,
      execArgs(target, shellCommand(WRITE_SCRIPT, [remotePath, String(info.size)]), true),
      () => ({ cwd: this.cwd, input: createReadStream(localPath) }),
    );
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot upload ${localPath} to ${remotePath}`);
    }
  }

  /**
   * Runs a transfer, and once more over SPDY when its WebSocket stream broke off; a cluster where SPDY then works
   * keeps using it. Only for what is safe to repeat: reads, and writes that WRITE_SCRIPT stages and checks. `options`
   * gives fresh streams for each attempt.
   */
  private async transfer(
    target: PodTarget,
    args: string[],
    options: () => RunOptions | Promise<RunOptions>,
  ): Promise<RunResult> {
    const viaWebSockets = !prefersSpdy(target.clusterId);
    const result = await runKubectl(target.clusterId, args, await options());
    if (result.code === 0 || !viaWebSockets || !isStreamFailure(result)) {
      return result;
    }
    const retried = await runKubectl(target.clusterId, args, { ...(await options()), websockets: false });
    if (retried.code === 0) {
      preferSpdy(target.clusterId);
    }
    return retried;
  }

  /**
   * Writes to a temporary file next to `localPath` and renames it over `localPath` once all of it is written, so
   * that a download that fails leaves a file the user chose to replace as it was.
   */
  private async writeLocal(localPath: string, write: (partPath: string) => Promise<void>) {
    const partPath = `${localPath}.${randomBytes(4).toString("hex")}.part`;
    try {
      await write(partPath);
      await rename(partPath, localPath);
    } catch (error) {
      await rm(partPath, { force: true });
      throw error;
    }
  }

  /**
   * Downloads a file in chunks of CHUNK_SIZE bytes, each read with `dd` in a kubectl exec of its own, checked for
   * its length and read again when it fails. One long stream of a large file is what a proxy in front of the API
   * server cuts most often; a chunk that breaks off costs only that chunk. Without `dd` in the container, the file
   * comes in one stream.
   */
  async downloadFile(target: PodTarget, remotePath: string, localPath: string, onProgress?: TransferProgress) {
    const info = (await this.exec(target, FILE_INFO_SCRIPT, [remotePath], `Cannot download ${remotePath}`)).toString(
      "utf8",
    );
    const [sizeText, tool] = info.trim().split(/\s+/);
    const size = Number(sizeText);
    if (!Number.isFinite(size)) {
      throw new RemoteError(`Cannot download ${remotePath}: cannot read its size`);
    }

    await this.writeLocal(localPath, async (partPath) => {
      if (tool !== "dd") {
        await this.downloadStream(target, remotePath, partPath);
        onProgress?.(size, size);
        return;
      }
      const handle = await open(partPath, "w");
      try {
        onProgress?.(0, size);
        for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
          const chunk = await this.readChunk(target, remotePath, offset, Math.min(CHUNK_SIZE, size - offset));
          await handle.write(chunk);
          onProgress?.(offset + chunk.length, size);
        }
      } finally {
        await handle.close();
      }
    });
  }

  private async readChunk(target: PodTarget, remotePath: string, offset: number, length: number): Promise<Buffer> {
    const args = execArgs(
      target,
      shellCommand(CHUNK_SCRIPT, [
        remotePath,
        String(offset / CHUNK_BLOCK_SIZE),
        String(CHUNK_SIZE / CHUNK_BLOCK_SIZE),
      ]),
    );
    let failure: Error | undefined;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
      const result = await this.transfer(target, args, () => ({ cwd: this.cwd, timeoutMs: CHUNK_TIMEOUT_MS }));
      if (result.code === 0 && result.stdout.length >= length) {
        // A file that grew since its size was read gives more; the download keeps the size it started with.
        return result.stdout.subarray(0, length);
      }
      failure =
        result.code !== 0
          ? describeFailure(result, `Cannot download ${remotePath}`)
          : new RemoteError(
              `Cannot download ${remotePath}: ${result.stdout.length} of ${length} bytes arrived at offset ${offset}; did the file shrink?`,
            );
      if (result.code !== 0 && !isStreamFailure(result)) {
        break;
      }
    }
    throw failure;
  }

  private async downloadStream(target: PodTarget, remotePath: string, partPath: string) {
    let output: WriteStream | undefined;
    const result = await this.transfer(target, execArgs(target, shellCommand(CAT_SCRIPT, [remotePath])), async () => {
      await this.closeStream(output);
      output = createWriteStream(partPath);
      return { cwd: this.cwd, output };
    });
    await this.closeStream(output);
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot download ${remotePath}`);
    }
  }

  /** Writes the directory as a gzipped tar archive; the container needs `tar`. */
  async downloadDirectory(target: PodTarget, remotePath: string, localPath: string) {
    await this.writeLocal(localPath, async (partPath) => {
      let written: Promise<void> | undefined;
      const result = await this.transfer(
        target,
        execArgs(target, shellCommand(TAR_SCRIPT, [parentPath(remotePath), baseName(remotePath)])),
        async () => {
          // A second attempt starts the archive over: the first attempt's file is finished before it is truncated.
          await written?.catch(() => {});
          const gzip = createGzip();
          written = pipeline(gzip, createWriteStream(partPath));
          return { cwd: this.cwd, output: gzip };
        },
      );
      if (result.code !== 0) {
        await written?.catch(() => {});
        throw describeFailure(result, `Cannot archive ${remotePath}`);
      }
      await written;
    });
  }

  private async closeStream(stream: WriteStream | undefined) {
    if (stream && !stream.closed) {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    }
  }

  async createFile(target: PodTarget, path: string) {
    await this.exec(target, CREATE_FILE_SCRIPT, [path], `Cannot create ${path}`);
  }

  async makeDirectory(target: PodTarget, path: string) {
    await this.exec(target, MAKE_DIRECTORY_SCRIPT, [path], `Cannot create ${path}`);
  }

  async rename(target: PodTarget, from: string, to: string) {
    await this.exec(target, RENAME_SCRIPT, [from, to], `Cannot rename ${from}`);
  }

  async remove(target: PodTarget, paths: string[]) {
    const unsafe = paths.find((path) => path.replace(/\/+$/, "") === "" || !path.startsWith("/"));
    if (unsafe !== undefined) {
      throw new RemoteError(`Refusing to delete "${unsafe}"`);
    }
    await this.exec(target, REMOVE_SCRIPT, paths, "Cannot delete", undefined);
  }

  async setAttributes(target: PodTarget, paths: string[], attributes: FileAttributes) {
    const mode = attributes.mode?.trim() ?? "";
    const owner = attributes.owner?.trim() ?? "";
    if (mode === "" && owner === "") {
      return;
    }
    if (mode !== "" && !isValidMode(mode)) {
      throw new RemoteError(`Invalid mode "${mode}"`);
    }
    if (owner !== "" && !isValidOwner(owner)) {
      throw new RemoteError(`Invalid owner "${owner}"`);
    }
    // The paths are absolute, so none of them can be taken for an option.
    const relative = paths.find((path) => !path.startsWith("/"));
    if (relative !== undefined || paths.length === 0) {
      throw new RemoteError(`Refusing to change "${relative ?? ""}"`);
    }
    await this.exec(
      target,
      ATTRIBUTES_SCRIPT,
      [attributes.recursive ? "1" : "0", owner, mode, ...paths],
      "Cannot change permissions",
      undefined,
    );
  }
}
