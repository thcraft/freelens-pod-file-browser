import { Renderer } from "@freelensapp/extensions";
import { type ReactNode, useEffect, useState } from "react";
import {
  type FileContent,
  MAX_EDITABLE_FILE_SIZE,
  type PodTarget,
  TEXT_ENCODINGS,
  type TextEncoding,
} from "../../common/protocol";
import { editorLanguageFor, formatSize } from "../format";
import { podFiles } from "../ipc";
import styles from "./dialogs.module.scss";

const { Button, ConfirmDialog, Dialog, MonacoEditor, Notifications, Select, Spinner } = Renderer.Component;

function encodingLabel(encoding: TextEncoding) {
  return TEXT_ENCODINGS.find((entry) => entry.id === encoding)?.label ?? encoding;
}

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
  // The encoding the user picked, for the file it was picked for; another file opens as UTF-8 again.
  const [picked, setPicked] = useState<{ path: string; encoding: TextEncoding }>();
  const encoding = path !== undefined && picked?.path === path ? picked.encoding : undefined;

  useEffect(() => {
    setFile(undefined);
    setError(undefined);
    setContent("");
    if (!path) {
      return;
    }
    let cancelled = false;
    podFiles.readFile(target, path, encoding).then(
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
  }, [target, path, encoding]);

  const editable = file !== undefined && !file.binary && file.lossless;
  const dirty = editable && content !== file.content;

  const confirmDiscard = async () =>
    !dirty ||
    ConfirmDialog.confirm({
      message: <p>Discard the unsaved changes to {path}?</p>,
      labelOk: "Discard",
    });

  const changeEncoding = async (next: TextEncoding) => {
    if (!path || next === file?.encoding || !(await confirmDiscard())) {
      return;
    }
    setPicked({ path, encoding: next });
  };

  const save = async () => {
    if (!path || !file || !dirty) {
      return;
    }
    setSaving(true);
    try {
      await podFiles.writeFile(target, path, content, file.encoding);
      setFile({ ...file, content });
      Notifications.ok(`Saved ${path}`);
      onSaved();
    } catch (failure) {
      Notifications.error(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (saving || !(await confirmDiscard())) {
      return;
    }
    onClose();
  };

  const notices: ReactNode[] = [];
  if (file?.binary && !encoding) {
    notices.push(
      <>
        This looks like a binary file ({formatSize(file.size)}), so it is not opened. Download it, or pick an encoding
        to look at it as text, read only.
      </>,
    );
  } else if (file?.binary) {
    notices.push(<>A binary file shown as {encodingLabel(file.encoding)}, read only.</>);
  } else if (file) {
    if (file.truncated) {
      notices.push(
        <>
          The file has {formatSize(file.size)}; only the first {formatSize(MAX_EDITABLE_FILE_SIZE)} are shown, read
          only.
        </>,
      );
    } else if (!file.lossless && file.encoding === "utf8") {
      notices.push(
        <>
          The file is not valid UTF-8, so it is read only. To edit it, pick the encoding it is written in, such as
          Windows-1250.
        </>,
      );
    } else if (!file.lossless) {
      notices.push(
        <>
          In {encodingLabel(file.encoding)} the file does not convert back to the same bytes, so saving would change
          parts you did not edit. It is read only; pick the encoding it is written in.
        </>,
      );
    }
  }

  let body: ReactNode;
  if (error) {
    body = <p className={styles.error}>{error}</p>;
  } else if (!file) {
    body = (
      <div className={styles.center}>
        <Spinner />
      </div>
    );
  } else if (file.binary && !encoding) {
    body = null;
  } else {
    body = (
      <MonacoEditor
        className={styles.editor}
        value={content}
        readOnly={!editable}
        language={editorLanguageFor(path ?? "")}
        onChange={(value) => setContent(value)}
      />
    );
  }

  return (
    <Dialog isOpen={path !== undefined} close={() => void close()} className={styles.dialog}>
      <div className={styles.editorBody}>
        <div className={styles.editorHeader}>
          <h5 className={styles.title}>
            {path}
            {dirty ? " *" : ""}
          </h5>
          <div className={styles.encoding}>
            <Select
              id="pod-files-editor-encoding"
              value={file?.encoding ?? null}
              isDisabled={!file || saving}
              options={TEXT_ENCODINGS.map((entry) => ({ value: entry.id, label: entry.label }))}
              onChange={(option) => option && void changeEncoding(option.value)}
            />
          </div>
        </div>
        {notices.map((notice, index) => (
          <p key={index} className={styles.notice}>
            {notice}
          </p>
        ))}
        {body}
        <div className={styles.buttons}>
          <Button plain label="Close" disabled={saving} onClick={() => void close()} />
          {editable ? (
            <Button primary label="Save" waiting={saving} disabled={!dirty} onClick={() => void save()} />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
