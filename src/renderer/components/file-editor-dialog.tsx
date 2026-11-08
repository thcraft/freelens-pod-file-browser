import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { type FileContent, MAX_EDITABLE_FILE_SIZE, type PodTarget } from "../../common/protocol";
import { editorLanguageFor, formatSize } from "../format";
import { podFiles } from "../ipc";
import styles from "./dialogs.module.scss";

const { Button, Dialog, MonacoEditor, Notifications, Spinner } = Renderer.Component;

export interface FileEditorDialogProps {
  target: PodTarget;
  /** The file to open; the dialog is closed while it is undefined. */
  path: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export function FileEditorDialog({ target, path, onClose, onSaved }: FileEditorDialogProps) {
  const [file, setFile] = useState<FileContent>();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFile(undefined);
    setError(undefined);
    setContent("");
    if (!path) {
      return;
    }
    let cancelled = false;
    podFiles.readFile(target, path).then(
      (result) => {
        if (!cancelled) {
          setFile(result);
          setContent(result.content);
        }
      },
      (failure: Error) => {
        if (!cancelled) {
          setError(failure.message);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, path]);

  const editable = file !== undefined && !file.binary && !file.truncated;
  const dirty = editable && content !== file.content;

  const save = async () => {
    if (!path || !dirty) {
      return;
    }
    setSaving(true);
    try {
      await podFiles.writeFile(target, path, content);
      setFile({ ...file, content, size: new TextEncoder().encode(content).length });
      Notifications.ok(`Saved ${path}`);
      onSaved();
    } catch (failure) {
      Notifications.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (
      dirty &&
      !(await Renderer.Component.ConfirmDialog.confirm({
        message: <p>Discard the unsaved changes to {path}?</p>,
        labelOk: "Discard",
      }))
    ) {
      return;
    }
    onClose();
  };

  let body: React.ReactNode;
  if (error) {
    body = <p className={styles.error}>{error}</p>;
  } else if (!file) {
    body = (
      <div className={styles.center}>
        <Spinner />
      </div>
    );
  } else if (file.binary) {
    body = <p className={styles.notice}>This is a binary file ({formatSize(file.size)}). Download it instead.</p>;
  } else {
    body = (
      <>
        {file.truncated ? (
          <p className={styles.notice}>
            The file has {formatSize(file.size)}; only the first {formatSize(MAX_EDITABLE_FILE_SIZE)} are shown, read
            only.
          </p>
        ) : null}
        <MonacoEditor
          className={styles.editor}
          value={content}
          readOnly={!editable}
          language={editorLanguageFor(path ?? "")}
          onChange={(value) => setContent(value)}
        />
      </>
    );
  }

  return (
    <Dialog isOpen={path !== undefined} close={() => void close()} className={styles.dialog}>
      <div className={styles.editorBody}>
        <h5 className={styles.title}>
          {path}
          {dirty ? " *" : ""}
        </h5>
        {body}
        <div className={styles.buttons}>
          <Button plain label="Close" onClick={() => void close()} />
          {editable ? (
            <Button primary label="Save" waiting={saving} disabled={!dirty} onClick={() => void save()} />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
