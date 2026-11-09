import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
import { Main } from "@freelensapp/extensions";
import type { Readable, Writable } from "node:stream";

import type { PodTarget } from "../common/protocol";

interface KubectlContext {
  kubectl: string;
  env: Record<string, string>;
  expires: number;
}

const CONTEXT_TTL_MS = 60_000;
const contexts = new Map<string, Promise<KubectlContext>>();

// The kubeconfig of a connected cluster is a temporary file that a disconnect
// removes; after a reconnect the environment names a new one.
function kubeconfigExists(env: Record<string, string>) {
  const files = (env.KUBECONFIG ?? "").split(delimiter).filter(Boolean);
  return files.every((file) => existsSync(file));
}

// `getEnvironment` reads the user's shell environment and may download a
// version-matched kubectl, so it is kept for a minute per cluster, as long as
// the kubeconfig it names still exists. A failed run drops the entry so that
// the next one asks again.
async function getContext(clusterId: string): Promise<KubectlContext> {
  const cached = contexts.get(clusterId);
  if (cached) {
    const context = await cached.catch(() => undefined);
    if (context && context.expires > Date.now() && kubeconfigExists(context.env)) {
      return context;
    }
  }

  const created = (async () => {
    const [kubectl, env] = await Promise.all([
      Main.Shell.getKubectlPath(clusterId),
      Main.Shell.getEnvironment(clusterId),
    ]);
    return { kubectl, env, expires: Date.now() + CONTEXT_TTL_MS };
  })();
  contexts.set(clusterId, created);
  created.catch(() => contexts.delete(clusterId));
  return created;
}

export function forgetContext(clusterId: string) {
  contexts.delete(clusterId);
}

export interface RunOptions {
  /** Data written to the process's stdin; the process gets `-i` when set. */
  input?: Readable | Uint8Array;
  /** Where stdout goes instead of being collected. */
  output?: Writable;
  cwd: string;
  /** Kills kubectl and fails after this long; transfers of files have none. */
  timeoutMs?: number;
  /**
   * The transport of kubectl exec: WebSockets, the default of kubectl since 1.30, or SPDY, the older one, which
   * `KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false` selects. Defaults to the one that last worked on the cluster.
   */
  websockets?: boolean;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

// Clusters where a WebSocket stream of kubectl exec broke off and SPDY then worked: some proxies in front of an API
// server (and versions of them) cut a WebSocket that carries a large transfer, with "error reading from error stream:
// read message" from kubectl.
const spdyClusters = new Set<string>();

export function prefersSpdy(clusterId: string) {
  return spdyClusters.has(clusterId);
}

export function preferSpdy(clusterId: string) {
  if (!spdyClusters.has(clusterId)) {
    spdyClusters.add(clusterId);
    console.warn(`[pod-file-browser] kubectl exec over WebSockets broke off on cluster ${clusterId}; using SPDY`);
  }
}

/** The stream of kubectl exec broke off, rather than the command in the container failing. */
export function isStreamFailure(result: RunResult) {
  return /error reading from error stream|read message|websocket: close|unexpected EOF|stream error|connection reset by peer|use of closed network connection/i.test(
    result.stderr,
  );
}

export async function runKubectl(clusterId: string, args: string[], options: RunOptions): Promise<RunResult> {
  const context = await getContext(clusterId);
  const { kubectl } = context;
  const websockets = options.websockets ?? !prefersSpdy(clusterId);
  const env = websockets ? context.env : { ...context.env, KUBECTL_REMOTE_COMMAND_WEBSOCKETS: "false" };

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(kubectl, args, {
      env,
      cwd: options.cwd,
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        forgetContext(clusterId);
        reject(error);
      }
    };

    const timer = options.timeoutMs
      ? setTimeout(
          () => fail(new RemoteError(`kubectl did not finish within ${Math.round((options.timeoutMs ?? 0) / 1000)} s`)),
          options.timeoutMs,
        )
      : undefined;

    child.on("error", fail);

    if (options.output) {
      child.stdout?.pipe(options.output);
      options.output.on("error", fail);
    } else {
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    }
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    if (options.input && child.stdin) {
      // A remote command that exits early closes the pipe; its exit code says why.
      child.stdin.on("error", () => {});
      if (options.input instanceof Uint8Array) {
        child.stdin.end(options.input);
      } else {
        options.input.on("error", fail);
        options.input.pipe(child.stdin);
      }
    }

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const finish = () =>
        resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8"), code: code ?? -1 });
      if (options.output && !options.output.writableFinished) {
        options.output.once("finish", finish);
        options.output.once("error", (error) => reject(error));
      } else {
        finish();
      }
    });
  });
}

export function execArgs(target: PodTarget, command: string[], interactive = false): string[] {
  return [
    "exec",
    ...(interactive ? ["-i"] : []),
    "--namespace",
    target.namespace,
    target.pod,
    "--container",
    target.container,
    "--",
    ...command,
  ];
}

/**
 * Runs a POSIX shell script in the container, with `args` as its positional
 * parameters, so that no path is ever interpolated into the script.
 */
export function shellCommand(script: string, args: string[] = []): string[] {
  return ["sh", "-c", script, "sh", ...args];
}

export class RemoteError extends Error {}

export function describeFailure(result: RunResult, action: string): RemoteError {
  const stderr = result.stderr.trim();
  if (/executable file not found|no such file or directory: unknown|exec: "sh"/i.test(stderr)) {
    return new RemoteError(
      `${action}: the container has no POSIX shell (sh). Images without a shell, such as distroless ones, cannot be browsed.`,
    );
  }
  return new RemoteError(`${action}: ${stderr || `kubectl exited with code ${result.code}`}`);
}
