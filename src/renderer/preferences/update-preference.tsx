import { Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { SettingsStore } from "../../common/settings-store";
import { NPM_PACKAGE_URL, PACKAGE_NAME, type UpdateStatus } from "../../common/updates";
import { podFiles } from "../ipc";
import styles from "./update-preference.module.scss";

const { Button, Checkbox } = Renderer.Component;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function describe(status: UpdateStatus | undefined) {
  if (!status) {
    return "";
  }
  if (status.error) {
    return `The last check failed: ${status.error}.`;
  }
  if (status.checkedAt === undefined) {
    return status.enabled ? "Not checked yet; the first check runs a minute after Freelens starts." : "";
  }
  const when = new Date(status.checkedAt).toLocaleString();
  if (!status.latest) {
    return `No version published yet (checked ${when}).`;
  }
  return status.newer
    ? `Version ${status.latest.version} is available (checked ${when}).`
    : `This is the newest version (checked ${when}).`;
}

export const UpdatePreferenceInput = observer(() => {
  const settings = SettingsStore.getInstanceOrCreate<SettingsStore>();
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    podFiles.updateStatus().then(
      (result) => !cancelled && setStatus(result),
      (failure) => !cancelled && setError(message(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setError(undefined);
    try {
      setStatus(await podFiles.checkForUpdates());
    } catch (failure) {
      setError(message(failure));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setError(undefined);
    try {
      await podFiles.installUpdate();
    } catch (failure) {
      setError(message(failure));
    }
  };

  const latest = status?.newer ? status.latest : undefined;

  return (
    <div className={styles.preference}>
      <Checkbox
        label="Check for new versions once a day and show a notification"
        value={settings.checkForUpdates}
        onChange={(value) =>
          runInAction(() => {
            settings.checkForUpdates = value;
          })
        }
      />
      <div className={styles.status}>
        <span>Installed version: {status?.installed ?? "..."}</span>
        <span>{error ? `Cannot read the status: ${error}` : describe(status)}</span>
      </div>
      <div className={styles.buttons}>
        {latest ? <Button primary label={`Install ${latest.version}`} onClick={() => void install()} /> : null}
        <Button
          outlined
          label="Check now"
          waiting={checking}
          disabled={!settings.checkForUpdates}
          onClick={() => void checkNow()}
        />
      </div>
    </div>
  );
});

export const UpdatePreferenceHint = () => (
  <span>
    The check asks the npm registry for the newest version of{" "}
    <a href={NPM_PACKAGE_URL} target="_blank" rel="noreferrer">
      {PACKAGE_NAME}
    </a>{" "}
    and sends nothing else. Installing a new version replaces the installed one after you confirm it in Freelens.
  </span>
);
