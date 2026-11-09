import { Main } from "@freelensapp/extensions";
import { Notification, shell } from "electron";
import { reaction, runInAction } from "mobx";
import {
  INSTALL_URL,
  isNewerVersion,
  LATEST_URL,
  type LatestRelease,
  parseLatestRelease,
  type UpdateStatus,
} from "../common/updates";

import type { SettingsStore } from "../common/settings-store";

const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Once a day, reads the newest version from the npm registry and shows a system notification for a version newer than
 * the installed one, once per version; clicking it installs the new version through Freelens. It runs in main, which exists once, rather than in the renderer, which runs in
 * every cluster frame and would notify once per frame. Turned off in the preferences, it reads nothing.
 */
export class UpdateChecker {
  private latest?: LatestRelease;
  private checkedAt?: number;
  private error?: string;
  private running?: Promise<UpdateStatus>;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly installed: string,
    private readonly settings: SettingsStore,
  ) {}

  start() {
    const first = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    const daily = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.disposers.push(
      () => clearTimeout(first),
      () => clearInterval(daily),
      // Turned on again in the preferences: check right away rather than tomorrow.
      reaction(
        () => this.settings.checkForUpdates,
        (enabled) => enabled && void this.check(),
      ),
    );
  }

  stop() {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  status(): UpdateStatus {
    return {
      enabled: this.settings.checkForUpdates,
      installed: this.installed,
      latest: this.latest,
      newer: this.latest !== undefined && isNewerVersion(this.latest.version, this.installed),
      checkedAt: this.checkedAt,
      error: this.error,
    };
  }

  /** Checks now; a check that is already running is shared. With the setting off, it only reports the status. */
  check(): Promise<UpdateStatus> {
    if (!this.settings.checkForUpdates) {
      return Promise.resolve(this.status());
    }
    this.running ??= this.fetchLatest().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async fetchLatest(): Promise<UpdateStatus> {
    try {
      // The host's fetch applies the user's proxy and certificate settings.
      const response = await Main.Util.fetch(LATEST_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        // Nothing has been published yet.
        this.latest = undefined;
      } else if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      } else {
        this.latest = parseLatestRelease(await response.json());
      }
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.checkedAt = Date.now();

    const status = this.status();
    if (status.newer && status.latest && this.settings.notifiedVersion !== status.latest.version) {
      const { latest } = status;
      runInAction(() => {
        this.settings.notifiedVersion = latest.version;
      });
      this.notify(latest);
    }
    return status;
  }

  /** Hands the install link to Freelens, which asks the user to confirm and replaces the installed version. */
  install() {
    return shell.openExternal(INSTALL_URL);
  }

  private notify(release: LatestRelease) {
    console.info(`[pod-file-browser] version ${release.version} is available`);
    if (!Notification.isSupported()) {
      return;
    }
    const notification = new Notification({
      title: `Pod File Browser ${release.version} is available`,
      body: `You have ${this.installed}. Click to install it in Freelens.`,
    });
    notification.on("click", () => void this.install());
    notification.show();
  }
}
