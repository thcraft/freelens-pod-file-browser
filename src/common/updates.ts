export const PACKAGE_NAME = "@thcraft/freelens-pod-file-browser";
export const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;

/**
 * The registry document of the version on the "latest" dist-tag: a few kilobytes, not the whole package document.
 * Public, like every package on npm; it needs no sign-in.
 */
export const LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}/latest`;

/**
 * Opens the Extensions page of Freelens and installs the newest version from the registry, after the user confirms
 * it; an installed older version is replaced.
 */
export const INSTALL_URL = `freelens://app/extensions/install/${PACKAGE_NAME}`;

export interface LatestRelease {
  version: string;
}

export interface UpdateStatus {
  enabled: boolean;
  installed: string;
  /** Undefined until a check has succeeded, and when nothing has been published yet. */
  latest?: LatestRelease;
  newer: boolean;
  /** Milliseconds since the epoch of the last check that finished. */
  checkedAt?: number;
  error?: string;
}

/** "v0.9.0", "0.9.0-beta.2" -> [0, 9, 0]; the pre-release suffix is ignored. Undefined for anything else. */
export function parseVersion(text: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(text.trim());
  return match ? match.slice(1, 4).map(Number) : undefined;
}

export function isNewerVersion(remote: string, local: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

/** The registry document of the latest version, or an error for anything else. */
export function parseLatestRelease(data: unknown): LatestRelease {
  const record = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (record.name !== PACKAGE_NAME) {
    throw new Error("the registry answered with another package");
  }
  const version = typeof record.version === "string" ? record.version : "";
  if (!parseVersion(version)) {
    throw new Error("the registry answered with no valid version");
  }
  return { version };
}
