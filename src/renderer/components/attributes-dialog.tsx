import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { type FileAttributes, isValidMode, isValidOwner } from "../../common/protocol";
import styles from "./dialogs.module.scss";

const { Button, Checkbox, Dialog, Input } = Renderer.Component;

export interface AttributesRequest {
  /** The items the dialog changes, such as a path or "3 items in /var/log". */
  subject: string;
  /** The current octal mode and owner (user:group), when all items share them. */
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

export function AttributesDialog({ request, onClose }: AttributesDialogProps) {
  const [mode, setMode] = useState("");
  const [owner, setOwner] = useState("");
  const [modeEdited, setModeEdited] = useState(false);
  const [ownerEdited, setOwnerEdited] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    setMode(request?.currentMode ?? "");
    setOwner(request?.currentOwner ?? "");
    setModeEdited(false);
    setOwnerEdited(false);
    setRecursive(false);
    setError(undefined);
    setWaiting(false);
  }, [request]);

  // A field is applied when its value differs from the current one. With -R it is applied also when it was edited,
  // so that the current value can be spread to everything inside; a field left alone is never applied, so that the
  // mode of a folder does not end up on the files in it.
  const applied = (value: string, current: string | undefined, edited: boolean) => {
    const trimmed = value.trim();
    return trimmed !== "" && (trimmed !== (current ?? "") || (recursive && edited)) ? trimmed : "";
  };
  const newMode = applied(mode, request?.currentMode, modeEdited);
  const newOwner = applied(owner, request?.currentOwner, ownerEdited);

  const flag = recursive ? " -R" : "";
  const commands = [newOwner ? `chown${flag} ${newOwner}` : "", newMode ? `chmod${flag} ${newMode}` : ""].filter(
    Boolean,
  );

  const submit = async () => {
    if (!request) {
      return;
    }
    if (newMode && !isValidMode(newMode)) {
      setError("The mode is not valid.");
      return;
    }
    if (newOwner && !isValidOwner(newOwner)) {
      setError("The owner is not valid.");
      return;
    }
    if (commands.length === 0) {
      onClose();
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
        <div>
          <h5 className={styles.title}>Change permissions</h5>
          <div className={styles.subject}>{request?.subject}</div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Mode</span>
          <Input
            autoFocus
            value={mode}
            onChange={(value) => {
              setMode(value);
              setModeEdited(true);
            }}
            onSubmit={() => void submit()}
            placeholder={request?.currentMode === undefined ? "differs between the items" : undefined}
          />
          <span className={styles.help}>Octal, such as 644 or 2775, or symbolic, such as u+x or g-w,o-rwx.</span>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Owner</span>
          <Input
            value={owner}
            onChange={(value) => {
              setOwner(value);
              setOwnerEdited(true);
            }}
            onSubmit={() => void submit()}
            placeholder={request?.currentOwner === undefined ? "differs between the items" : undefined}
          />
          <span className={styles.help}>
            user:group, user or :group, by name or numeric id. Usually needs the container to run as root.
          </span>
        </div>

        {request?.hasDirectory ? (
          <div className={styles.field}>
            <Checkbox
              label="Also everything inside the folders"
              value={recursive}
              onChange={(value) => setRecursive(value)}
            />
            {recursive ? (
              <span className={styles.help}>
                Files and folders get the same mode; a capital X, as in u=rwX,go=rX, sets execute on folders only.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className={styles.preview}>{commands.length ? commands.join(" ; ") : "Nothing to change"}</div>

        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.buttons}>
          <Button plain label="Cancel" onClick={onClose} />
          <Button
            primary
            label="Apply"
            waiting={waiting}
            disabled={commands.length === 0}
            onClick={() => void submit()}
          />
        </div>
      </div>
    </Dialog>
  );
}
