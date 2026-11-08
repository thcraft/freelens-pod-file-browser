import { Renderer } from "@freelensapp/extensions";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  baseName,
  type DirectoryListing,
  type FileEntry,
  joinPath,
  MAX_DROP_UPLOAD_SIZE,
  type PodTarget,
  parentPath,
} from "../../common/protocol";
import { formatSize, formatTime, isDirectoryLike, permissionsToOctal, type SortColumn, sortEntries } from "../format";
import { podFiles } from "../ipc";
import { AttributesDialog, type AttributesRequest } from "./attributes-dialog";
import styles from "./file-browser.module.scss";
import { FileEditorDialog } from "./file-editor-dialog";
import { type NamePrompt, NamePromptDialog } from "./name-prompt-dialog";

const { Button, Checkbox, ConfirmDialog, Icon, Input, Notifications, Spinner } = Renderer.Component;

export interface FileBrowserProps {
  target: PodTarget;
  /** The directory to show; empty for the container's working directory. */
  path: string;
  onNavigate: (path: string) => void;
  /** A smaller layout for the pod details drawer: fewer columns and a fixed height. */
  compact?: boolean;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function entryIcon(entry: FileEntry) {
  if (entry.kind === "symlink") {
    return entry.targetIsDirectory ? "folder_special" : "link";
  }
  if (entry.kind === "directory") {
    return "folder";
  }
  return entry.kind === "other" ? "device_unknown" : "description";
}

/** The value all entries share, or undefined. */
function shared(entries: FileEntry[], value: (entry: FileEntry) => string | undefined) {
  const values = new Set(entries.map(value));
  return values.size === 1 ? [...values][0] : undefined;
}

export function FileBrowser({ target, path, onNavigate, compact = false }: FileBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [listingError, setListingError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(true);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; descending: boolean }>({ column: "name", descending: false });
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const [prompt, setPrompt] = useState<NamePrompt>();
  const [editing, setEditing] = useState<string>();
  const [attributes, setAttributes] = useState<AttributesRequest>();

  // Names to select once the listing has loaded again, such as the files just uploaded.
  const selectAfterReload = useRef<string[] | undefined>(undefined);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    setSelected(new Set());
    let cancelled = false;
    setLoading(true);
    setListingError(undefined);
    podFiles
      .listDirectory(target, path)
      .then(
        (result) => {
          if (!cancelled) {
            setListing(result);
            setPathInput(result.path);
            if (selectAfterReload.current) {
              setSelected(new Set(selectAfterReload.current));
              selectAfterReload.current = undefined;
            }
          }
        },
        (error) => {
          if (!cancelled) {
            setListing(undefined);
            setListingError(message(error));
            setPathInput(path);
          }
        },
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [target, path, reloadKey]);

  const currentPath = listing?.path ?? path;

  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const entries = (listing?.entries ?? []).filter(
      (entry) => (showHidden || !entry.name.startsWith(".")) && (!needle || entry.name.toLowerCase().includes(needle)),
    );
    return sortEntries(entries, sort.column, sort.descending);
  }, [listing, showHidden, filter, sort]);

  const run = async (label: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(label);
    try {
      await action();
      if (success) {
        Notifications.ok(success);
      }
    } catch (error) {
      Notifications.error(message(error));
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  const confirmOverwrite = async (names: string[]) => {
    const existing = names.filter((name) => listing?.entries.some((entry) => entry.name === name));
    if (existing.length === 0) {
      return true;
    }
    return ConfirmDialog.confirm({
      message: (
        <p>
          {existing.length === 1 ? `${existing[0]} already exists` : `${existing.length} files already exist`} in{" "}
          {currentPath}. Overwrite?
        </p>
      ),
      labelOk: "Overwrite",
    });
  };

  const uploaded = (names: string[]) =>
    `${names.length === 1 ? `Uploaded ${names[0]}` : `Uploaded ${names.length} files`}; ${
      names.length === 1 ? "it is" : "they are"
    } selected, so Permissions changes ${names.length === 1 ? "it" : "them"}.`;

  const upload = async () => {
    try {
      const files = await podFiles.pickUploadFiles();
      if (files.length === 0 || !(await confirmOverwrite(files.map((file) => file.name)))) {
        return;
      }
      await run("Uploading", async () => {
        const result = await podFiles.uploadFiles(
          target,
          currentPath,
          files.map((file) => file.path),
        );
        const names = result.uploaded.map(baseName);
        selectAfterReload.current = names;
        Notifications.ok(uploaded(names));
      });
    } catch (error) {
      Notifications.error(message(error));
    }
  };

  const uploadDropped = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const tooBig = files.find((file) => file.size > MAX_DROP_UPLOAD_SIZE);
    if (tooBig) {
      Notifications.error(
        `${tooBig.name} has ${formatSize(tooBig.size)}; dropped files may have at most ${formatSize(MAX_DROP_UPLOAD_SIZE)}. Use Upload for larger files.`,
      );
      return;
    }
    if (!(await confirmOverwrite(files.map((file) => file.name)))) {
      return;
    }
    await run("Uploading", async () => {
      const names: string[] = [];
      try {
        for (const file of files) {
          await podFiles.uploadData(target, joinPath(currentPath, file.name), new Uint8Array(await file.arrayBuffer()));
          names.push(file.name);
        }
      } finally {
        selectAfterReload.current = names;
      }
      Notifications.ok(uploaded(names));
    });
  };

  const download = async (entries: FileEntry[]) => {
    if (entries.length === 0) {
      return;
    }
    await run("Downloading", async () => {
      const result = await podFiles.download(
        target,
        entries.map((entry) => ({ path: joinPath(currentPath, entry.name), isDirectory: isDirectoryLike(entry) })),
      );
      if (result.saved.length > 0) {
        Notifications.ok(result.saved.length === 1 ? `Saved ${result.saved[0]}` : `Saved ${result.saved.length} items`);
      }
    });
  };

  const remove = async (entries: FileEntry[]) => {
    if (entries.length === 0) {
      return;
    }
    const confirmed = await ConfirmDialog.confirm({
      message: (
        <p>
          Delete {entries.length === 1 ? <b>{joinPath(currentPath, entries[0].name)}</b> : `${entries.length} items`}
          {entries.some((entry) => entry.kind === "directory") ? " with everything in it" : ""}? This cannot be undone.
        </p>
      ),
      labelOk: "Delete",
      okButtonProps: { accent: true },
    });
    if (confirmed) {
      await run(
        "Deleting",
        () =>
          podFiles.remove(
            target,
            entries.map((entry) => joinPath(currentPath, entry.name)),
          ),
        entries.length === 1 ? `Deleted ${entries[0].name}` : `Deleted ${entries.length} items`,
      );
    }
  };

  const changeAttributes = (entries: FileEntry[]) => {
    if (entries.length === 0) {
      return;
    }
    const owner = shared(entries, (entry) => (entry.owner ? `${entry.owner}:${entry.group}` : undefined));
    setAttributes({
      title: `Permissions of ${entries.length === 1 ? joinPath(currentPath, entries[0].name) : `${entries.length} items`}`,
      currentMode: shared(entries, (entry) => permissionsToOctal(entry.permissions)),
      currentOwner: owner,
      hasDirectory: entries.some((entry) => entry.kind === "directory"),
      onSubmit: async (values) => {
        const names = entries.map((entry) => entry.name);
        await podFiles.setAttributes(
          target,
          names.map((name) => joinPath(currentPath, name)),
          values,
        );
        Notifications.ok(entries.length === 1 ? `Changed ${entries[0].name}` : `Changed ${entries.length} items`);
        selectAfterReload.current = names;
        reload();
      },
    });
  };

  const rename = (entry: FileEntry) => {
    setPrompt({
      title: `Rename ${entry.name}`,
      label: "New name",
      initialValue: entry.name,
      submitLabel: "Rename",
      onSubmit: async (name) => {
        await podFiles.rename(target, joinPath(currentPath, entry.name), joinPath(currentPath, name));
        selectAfterReload.current = [name];
        reload();
      },
    });
  };

  const createDirectory = () => {
    setPrompt({
      title: `New folder in ${currentPath}`,
      label: "Folder name",
      submitLabel: "Create",
      onSubmit: async (name) => {
        await podFiles.makeDirectory(target, joinPath(currentPath, name));
        selectAfterReload.current = [name];
        reload();
      },
    });
  };

  const createFile = () => {
    setPrompt({
      title: `New file in ${currentPath}`,
      label: "File name",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const filePath = joinPath(currentPath, name);
        await podFiles.createFile(target, filePath);
        selectAfterReload.current = [name];
        reload();
        setEditing(filePath);
      },
    });
  };

  const open = (entry: FileEntry) => {
    const entryPath = joinPath(currentPath, entry.name);
    if (isDirectoryLike(entry)) {
      onNavigate(entryPath);
    } else if (entry.kind === "file" || entry.kind === "symlink") {
      setEditing(entryPath);
    }
  };

  const toggle = (name: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectedEntries = visibleEntries.filter((entry) => selected.has(entry.name));
  const allSelected = visibleEntries.length > 0 && selectedEntries.length === visibleEntries.length;
  const count = selectedEntries.length ? ` (${selectedEntries.length})` : "";

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    void uploadDropped([...event.dataTransfer.files]);
  };

  const sortBy = (column: SortColumn) =>
    setSort((previous) => ({
      column,
      descending: previous.column === column ? !previous.descending : false,
    }));

  const sortIndicator = (column: SortColumn) =>
    sort.column === column ? <Icon small material={sort.descending ? "arrow_drop_down" : "arrow_drop_up"} /> : null;

  const breadcrumbs = currentPath
    .split("/")
    .filter(Boolean)
    .map((segment, index, segments) => ({ name: segment, path: `/${segments.slice(0, index + 1).join("/")}` }));

  return (
    <div className={`${styles.browser} ${compact ? styles.compact : ""}`}>
      <div className={styles.pathBar}>
        <Icon
          material="arrow_upward"
          interactive
          tooltip="Parent folder"
          onClick={() => onNavigate(parentPath(currentPath))}
        />
        <Icon material="home" interactive tooltip="Working directory" onClick={() => onNavigate("")} />
        <div className={styles.breadcrumbs}>
          <button type="button" className={styles.crumb} onClick={() => onNavigate("/")}>
            /
          </button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className={styles.crumbGroup}>
              <button type="button" className={styles.crumb} onClick={() => onNavigate(crumb.path)}>
                {crumb.name}
              </button>
              <span className={styles.separator}>/</span>
            </span>
          ))}
        </div>
        <Input
          className={styles.pathInput}
          value={pathInput}
          onChange={(value) => setPathInput(value)}
          onSubmit={(value) => onNavigate(value.trim())}
          placeholder="Go to path and press Enter"
        />
        <Icon material="refresh" interactive tooltip="Reload" onClick={reload} />
      </div>

      <div className={styles.actions}>
        <Button primary label="Upload" onClick={() => void upload()} disabled={!!busy} />
        <Button plain label="New folder" onClick={createDirectory} disabled={!!busy} />
        <Button plain label="New file" onClick={createFile} disabled={!!busy} />
        <Button
          plain
          label={`Download${count}`}
          onClick={() => void download(selectedEntries)}
          disabled={!!busy || selectedEntries.length === 0}
        />
        <Button
          plain
          label={`Permissions${count}`}
          onClick={() => changeAttributes(selectedEntries)}
          disabled={!!busy || selectedEntries.length === 0}
        />
        <Button
          plain
          label={`Delete${count}`}
          onClick={() => void remove(selectedEntries)}
          disabled={!!busy || selectedEntries.length === 0}
        />
        <Checkbox label="Hidden files" value={showHidden} onChange={(value) => setShowHidden(value)} />
        <Input className={styles.filter} value={filter} onChange={(value) => setFilter(value)} placeholder="Filter" />
        {busy ? (
          <span className={styles.busy}>
            <Spinner /> {busy}...
          </span>
        ) : null}
      </div>

      <div
        className={`${styles.listing} ${dragOver ? styles.dragOver : ""}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {listingError ? <div className={styles.error}>{listingError}</div> : null}
        {loading && !listing ? (
          <div className={styles.empty}>
            <Spinner />
          </div>
        ) : listing ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkColumn}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(visibleEntries.map((entry) => entry.name)))
                    }
                  />
                </th>
                <th className={styles.sortable} onClick={() => sortBy("name")}>
                  Name {sortIndicator("name")}
                </th>
                <th className={`${styles.sortable} ${styles.number}`} onClick={() => sortBy("size")}>
                  Size {sortIndicator("size")}
                </th>
                {compact ? null : (
                  <th className={styles.sortable} onClick={() => sortBy("modified")}>
                    Modified {sortIndicator("modified")}
                  </th>
                )}
                <th>Permissions</th>
                <th>Owner</th>
                <th className={styles.rowActions} />
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr
                  key={entry.name}
                  className={selected.has(entry.name) ? styles.selected : undefined}
                  onDoubleClick={() => open(entry)}
                >
                  <td className={styles.checkColumn}>
                    <input type="checkbox" checked={selected.has(entry.name)} onChange={() => toggle(entry.name)} />
                  </td>
                  <td className={styles.name} title={compact ? formatTime(entry.modified) : undefined}>
                    <Icon small material={entryIcon(entry)} />
                    <button type="button" className={styles.entryLink} onClick={() => open(entry)}>
                      {entry.name}
                    </button>
                    {entry.linkTarget ? <span className={styles.linkTarget}> -&gt; {entry.linkTarget}</span> : null}
                  </td>
                  <td className={styles.number}>{isDirectoryLike(entry) ? "" : formatSize(entry.size)}</td>
                  {compact ? null : <td>{formatTime(entry.modified)}</td>}
                  <td className={styles.mono}>{entry.permissions}</td>
                  <td>{entry.owner ? `${entry.owner}:${entry.group}` : ""}</td>
                  <td className={styles.rowActions}>
                    <Icon
                      small
                      material="download"
                      interactive
                      tooltip="Download"
                      onClick={() => void download([entry])}
                    />
                    <Icon
                      small
                      material="lock"
                      interactive
                      tooltip="Permissions (chmod, chown)"
                      onClick={() => changeAttributes([entry])}
                    />
                    <Icon small material="edit" interactive tooltip="Rename" onClick={() => rename(entry)} />
                    <Icon small material="delete" interactive tooltip="Delete" onClick={() => void remove([entry])} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {listing && visibleEntries.length === 0 ? (
          <div className={styles.empty}>
            {listing.entries.length === 0 ? "This folder is empty." : "No item matches the filter."}
          </div>
        ) : null}
        <div className={styles.dropHint}>Drop files here to upload them to {currentPath}</div>
      </div>

      <div className={styles.status}>
        {listing
          ? `${listing.entries.length} items${listing.hasDetails ? "" : " - the container has no stat, sizes and times are not shown"}`
          : ""}
      </div>

      <FileEditorDialog target={target} path={editing} onClose={() => setEditing(undefined)} onSaved={reload} />
      <NamePromptDialog prompt={prompt} onClose={() => setPrompt(undefined)} />
      <AttributesDialog request={attributes} onClose={() => setAttributes(undefined)} />
    </div>
  );
}
