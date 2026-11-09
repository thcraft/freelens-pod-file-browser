import { Common } from "@freelensapp/extensions";
import { observable } from "mobx";

export interface SettingsModel {
  /** Check once a day whether a newer version has been released, and tell the user once per version. */
  checkForUpdates: boolean;
  /** The newest version the user has been told about. */
  notifiedVersion: string;
}

/**
 * The extension's settings, loaded by both processes: the host keeps one file and syncs the two copies, so the
 * preference set in the renderer reaches the update check in main.
 */
export class SettingsStore extends Common.Store.ExtensionStore<SettingsModel> {
  @observable accessor checkForUpdates = true;
  @observable accessor notifiedVersion = "";

  constructor() {
    super({
      configName: "pod-file-browser-settings",
      defaults: {
        checkForUpdates: true,
        notifiedVersion: "",
      },
    });
  }

  fromStore({ checkForUpdates = true, notifiedVersion = "" }: Partial<SettingsModel>): void {
    this.checkForUpdates = checkForUpdates;
    this.notifiedVersion = notifiedVersion;
  }

  toJSON(): SettingsModel {
    return {
      checkForUpdates: this.checkForUpdates,
      notifiedVersion: this.notifiedVersion,
    };
  }
}
