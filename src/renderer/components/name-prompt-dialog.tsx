import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { isValidFileName } from "../../common/protocol";
import styles from "./dialogs.module.scss";

const { Button, Dialog, Input } = Renderer.Component;

export interface NamePrompt {
  title: string;
  label: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
}

export interface NamePromptDialogProps {
  prompt: NamePrompt | undefined;
  onClose: () => void;
}

export function NamePromptDialog({ prompt, onClose }: NamePromptDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    setValue(prompt?.initialValue ?? "");
    setError(undefined);
    setWaiting(false);
  }, [prompt]);

  const submit = async () => {
    if (!prompt) {
      return;
    }
    const name = value.trim();
    if (!isValidFileName(name)) {
      setError("Enter a name without a slash.");
      return;
    }
    setWaiting(true);
    try {
      await prompt.onSubmit(name);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setWaiting(false);
    }
  };

  return (
    <Dialog isOpen={prompt !== undefined} close={onClose} className={styles.dialog}>
      <div className={styles.promptBody}>
        <h5 className={styles.title}>{prompt?.title}</h5>
        <label className={styles.label}>
          {prompt?.label}
          <Input
            autoFocus
            value={value}
            onChange={(next) => setValue(next)}
            onSubmit={() => void submit()}
            placeholder="name"
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.buttons}>
          <Button plain label="Cancel" onClick={onClose} />
          <Button primary label={prompt?.submitLabel} waiting={waiting} onClick={() => void submit()} />
        </div>
      </div>
    </Dialog>
  );
}
