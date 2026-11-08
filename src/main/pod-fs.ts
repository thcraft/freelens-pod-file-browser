import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  baseName,
  type DirectoryListing,
  type FileContent,
  type FileEntry,
  type FileEntryKind,
  MAX_EDITABLE_FILE_SIZE,
  type PodInfo,
  type PodTarget,
  parentPath,
} from "../common/protocol";
import { describeFailure, execArgs, RemoteError, runKubectl, shellCommand } from "./kubectl";

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

const WRITE_SCRIPT = `cat > "$1"`;
export const CREATE_FILE_SCRIPT = `if [ -e "$1" ] || [ -L "$1" ]; then echo "already exists: $1" >&2; exit 5; fi; : > "$1"`;
const MAKE_DIRECTORY_SCRIPT = `mkdir -- "$1"`;
export const RENAME_SCRIPT = `if [ -e "$2" ] || [ -L "$2" ]; then echo "already exists: $2" >&2; exit 5; fi; mv -- "$1" "$2"`;
const REMOVE_SCRIPT = `rm -rf -- "$@"`;
const CAT_SCRIPT = `cat -- "$1"`;
export const TAR_SCRIPT = `cd -- "$1" && tar cf - "./$2"`;

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

interface KubePodList {
  items?: Array<{
    metadata?: { name?: string };
    spec?: {
      containers?: Array<{ name: string }>;
      initContainers?: Array<{ name: string }>;
      ephemeralContainers?: Array<{ name: string }>;
    };
    status?: {
      phase?: string;
      containerStatuses?: Array<{ name: string; state?: { running?: unknown } }>;
      initContainerStatuses?: Array<{ name: string; state?: { running?: unknown } }>;
      ephemeralContainerStatuses?: Array<{ name: string; state?: { running?: unknown } }>;
    };
  }>;
}

export class PodFileSystem {
  constructor(private readonly cwd: string) {}

  private async exec(target: PodTarget, script: string, args: string[], action: string) {
    const result = await runKubectl(target.clusterId, execArgs(target, shellCommand(script, args)), { cwd: this.cwd });
    if (result.code !== 0) {
      throw describeFailure(result, action);
    }
    return result.stdout;
  }

  async listPods(clusterId: string, namespace: string): Promise<PodInfo[]> {
    const result = await runKubectl(clusterId, ["get", "pods", "--namespace", namespace, "--output", "json"], {
      cwd: this.cwd,
    });
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot list pods in ${namespace}`);
    }
    const list = JSON.parse(result.stdout.toString("utf8")) as KubePodList;

    return (list.items ?? []).map((item) => {
      const statuses = [
        ...(item.status?.containerStatuses ?? []),
        ...(item.status?.initContainerStatuses ?? []),
        ...(item.status?.ephemeralContainerStatuses ?? []),
      ];
      const isRunning = (name: string) => statuses.some((s) => s.name === name && s.state?.running !== undefined);
      return {
        name: item.metadata?.name ?? "",
        phase: item.status?.phase ?? "Unknown",
        containers: [
          ...(item.spec?.containers ?? []).map((c) => ({ name: c.name, running: isRunning(c.name), init: false })),
          ...(item.spec?.ephemeralContainers ?? []).map((c) => ({
            name: c.name,
            running: isRunning(c.name),
            init: false,
          })),
          ...(item.spec?.initContainers ?? []).map((c) => ({ name: c.name, running: isRunning(c.name), init: true })),
        ],
      };
    });
  }

  async listDirectory(target: PodTarget, path: string): Promise<DirectoryListing> {
    const output = await this.exec(target, LIST_SCRIPT, [path], `Cannot open ${path || "the working directory"}`);
    return parseListing(output.toString("utf8"), path);
  }

  async readFile(target: PodTarget, path: string): Promise<FileContent> {
    const output = await this.exec(target, READ_SCRIPT, [path, String(MAX_EDITABLE_FILE_SIZE)], `Cannot read ${path}`);
    const newline = output.indexOf(0x0a);
    const size = Number(output.subarray(0, newline).toString("utf8").trim());
    const data = output.subarray(newline + 1);
    const binary = data.includes(0);

    return {
      path,
      size,
      truncated: size > data.length,
      binary,
      content: binary ? "" : data.toString("utf8"),
    };
  }

  async writeFile(target: PodTarget, path: string, content: string | Uint8Array) {
    const input = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const result = await runKubectl(target.clusterId, execArgs(target, shellCommand(WRITE_SCRIPT, [path]), true), {
      cwd: this.cwd,
      input,
    });
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot write ${path}`);
    }
  }

  async uploadLocalFile(target: PodTarget, localPath: string, remotePath: string) {
    const info = await stat(localPath);
    if (!info.isFile()) {
      throw new RemoteError(`${localPath} is not a file`);
    }
    const result = await runKubectl(
      target.clusterId,
      execArgs(target, shellCommand(WRITE_SCRIPT, [remotePath]), true),
      { cwd: this.cwd, input: createReadStream(localPath) },
    );
    if (result.code !== 0) {
      throw describeFailure(result, `Cannot upload ${localPath} to ${remotePath}`);
    }
  }

  async downloadFile(target: PodTarget, remotePath: string, localPath: string) {
    const output = createWriteStream(localPath);
    try {
      const result = await runKubectl(target.clusterId, execArgs(target, shellCommand(CAT_SCRIPT, [remotePath])), {
        cwd: this.cwd,
        output,
      });
      if (result.code !== 0) {
        throw describeFailure(result, `Cannot download ${remotePath}`);
      }
    } catch (error) {
      output.destroy();
      await rm(localPath, { force: true });
      throw error;
    }
  }

  /** Writes the directory as a gzipped tar archive; the container needs `tar`. */
  async downloadDirectory(target: PodTarget, remotePath: string, localPath: string) {
    const gzip = createGzip();
    const written = pipeline(gzip, createWriteStream(localPath));
    try {
      const result = await runKubectl(
        target.clusterId,
        execArgs(target, shellCommand(TAR_SCRIPT, [parentPath(remotePath), baseName(remotePath)])),
        { cwd: this.cwd, output: gzip },
      );
      if (result.code !== 0) {
        throw describeFailure(result, `Cannot archive ${remotePath}`);
      }
      await written;
    } catch (error) {
      gzip.destroy();
      await written.catch(() => {});
      await rm(localPath, { force: true });
      throw error;
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
    await this.exec(target, REMOVE_SCRIPT, paths, "Cannot delete");
  }
}
