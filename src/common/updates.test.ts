import { observable, reaction, runInAction } from "mobx";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store";
import { isNewerVersion, PACKAGE_NAME, parseLatestRelease, parseVersion } from "./updates";

describe("versions", () => {
  it("parses versions with or without v and ignores pre-release suffixes", () => {
    expect(parseVersion("0.3.0")).toEqual([0, 3, 0]);
    expect(parseVersion("v1.2.10")).toEqual([1, 2, 10]);
    expect(parseVersion("1.0.0-beta.2")).toEqual([1, 0, 0]);
    expect(parseVersion("development")).toBeUndefined();
  });

  it("compares numerically", () => {
    expect(isNewerVersion("0.3.1", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.2.9", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.4.0", "development")).toBe(false);
  });
});

describe("parseLatestRelease", () => {
  it("reads the registry document of the latest version", () => {
    expect(parseLatestRelease({ name: PACKAGE_NAME, version: "0.4.0", dist: {} })).toEqual({ version: "0.4.0" });
  });

  it("rejects another package and a missing version", () => {
    expect(() => parseLatestRelease({ name: "other", version: "1.0.0" })).toThrow();
    expect(() => parseLatestRelease({ name: PACKAGE_NAME })).toThrow();
    expect(() => parseLatestRelease("nonsense")).toThrow();
  });
});

describe("SettingsStore", () => {
  it("runs on the development build of mobx, which rejects @observable on a plain field", () => {
    expect(() => {
      class LegacyStore {
        @observable enabled = false;
      }
      return LegacyStore;
    }).toThrow("Please use `@observable accessor enabled`");
  });

  it("checks for updates by default and saves changes", () => {
    const store = new SettingsStore();
    expect(store.toJSON()).toEqual({ checkForUpdates: true, notifiedVersion: "" });

    const saved: unknown[] = [];
    const dispose = reaction(
      () => store.toJSON(),
      (model) => saved.push(model),
    );
    try {
      runInAction(() => {
        store.checkForUpdates = false;
      });
      runInAction(() => store.fromStore({ notifiedVersion: "0.4.0" }));
    } finally {
      dispose();
    }

    expect(saved).toEqual([
      { checkForUpdates: false, notifiedVersion: "" },
      { checkForUpdates: true, notifiedVersion: "0.4.0" },
    ]);
  });
});
