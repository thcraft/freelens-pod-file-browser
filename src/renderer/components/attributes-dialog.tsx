import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { type FileAttributes, isValidMode, isValidOwner } from "../../common/protocol";
import styles from "./dialogs.module.scss";

const { Button, Checkbox, Dialog, Input } = Renderer.Component;

export interface AttributesRequest {
  /** What the dialog changes, as shown in its title. */
  title: string;
  /** The current mode and owner, shown as a hint when all items share them. */
  currentMode?: string;
  currentOwner?: string;
  /** Whether "recursive" is offered: only when a directory is among the items. */
  hasDirectory: boolean;
  onSubmit: (attributes: FileAttributes) => Promise<void>;
}

export interface AttributesDialogProps {
  request: AttributesRequest | undefined;
  onClose: () => void;
}

const modePresets = ["644", "664", "600", "755", "775", "u+x"];

export function AttributesDialog({ request, onClose }: AttributesDialogProps) {
  const [mode, setMode] = useState("");
  const [owner, setOwner] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    setMode("");
    setOwner("");
    setRecursive(false);
    setError(undefined);
    setWaiting(false);
  }, [request]);

  const newMode = mode.trim();
  const newOwner = owner.trim();

  const submit = async () => {
    if (!request) {
      return;
    }
    if (newMode && !isValidMode(newMode)) {
      setError("The mode is octal, such as 644 or 2775, or symbolic, such as u+x or g-w,o-rwx.");
      return;
    }
    if (newOwner && !isValidOwner(newOwner)) {
      setError("The owner is user, user:group or :group, by name or numeric id.");
      return;
    }
    if (!newMode && !newOwner) {
      setError("Enter a mode, an owner or both.");
      return;
    }
    setWaiting(true);
    try {
      await request.onSubmit({ mode: newMode, owner: newOwner, recursive });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setWaiting(false);
    }
  };

  return (
    <Dialog isOpen={request !== undefined} close={onClose} className={styles.dialog}>
      <div className={styles.promptBody}>
        <h5 className={styles.title}>{request?.title}</h5>
        <label className={styles.label}>
          <span>
            Mode (chmod)
            {request?.currentMode ? <span className={styles.current}> - now {request.currentMode}</span> : null}
          </span>
          <Input
            autoFocus
            value={mode}
            onChange={(value) => setMode(value)}
            onSubmit={() => void submit()}
            placeholder="644, 2775, u+x, g-w,o-rwx"
          />
        </label>
        <div className={styles.presets}>
          {modePresets.map((preset) => (
            <button key={preset} type="button" className={styles.preset} onClick={() => setMode(preset)}>
              {preset}
            </button>
          ))}
        </div>
        <label className={styles.label}>
          <span>
            Owner (chown)
            {request?.currentOwner ? <span className={styles.current}> - now {request.currentOwner}</span> : null}
          </span>
          <Input
            value={owner}
            onChange={(value) => setOwner(value)}
            onSubmit={() => void submit()}
            placeholder="user:group, 1000:1000, :group"
          />
        </label>
        {request?.hasDirectory ? (
          <Checkbox
            label="Apply to everything inside the folders too (-R)"
            value={recursive}
            onChange={(value) => setRecursive(value)}
          />
        ) : null}
        <p className={styles.notice}>
          An empty field is left as it is. Changing the owner usually needs the container to run as root.
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.buttons}>
          <Button plain label="Cancel" onClick={onClose} />
          <Button primary label="Apply" waiting={waiting} onClick={() => void submit()} />
        </div>
      </div>
    </Dialog>
  );
}
