import { type Common, Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type DirectoryListing,
  type FileEntry,
  joinPath,
  MAX_DROP_UPLOAD_SIZE,
  type PodInfo,
  type PodTarget,
  parentPath,
} from "../../common/protocol";
import { FileEditorDialog } from "../components/file-editor-dialog";
import { type NamePrompt, NamePromptDialog } from "../components/name-prompt-dialog";
import { formatSize, formatTime, isDirectoryLike, type SortColumn, sortEntries } from "../format";
import { podFiles } from "../ipc";
import styles from "./pod-files-page.module.scss";

const { Button, Checkbox, ConfirmDialog, Icon, Input, NamespaceSelect, Notifications, Select, Spinner } =
  Renderer.Component;

export const podFilesPageId = "pod-files";

export const podFilesPageParams = {
  namespace: "",
  pod: "",
  container: "",
  path: "",
};

type PodFilesPageParam = keyof typeof podFilesPageParams;

export type PodFilesPageProps = Common.Types.PageComponentProps;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function defaultContainer(pod: PodInfo | undefined) {
  const containers = pod?.containers ?? [];
  return (containers.find((c) => c.running && !c.init) ?? containers.find((c) => !c.init) ?? containers[0])?.name ?? "";
}

export const PodFilesPage = observer(({ params }: PodFilesPageProps) => {
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;
  const namespace = (params.namespace?.get() as string | undefined) || "default";
  const podName = (params.pod?.get() as string | undefined) ?? "";
  const containerParam = (params.container?.get() as string | undefined) ?? "";
  const pathParam = (params.path?.get() as string | undefined) ?? "";

  const [pods, setPods] = useState<PodInfo[]>([]);
  const [podsError, setPodsError] = useState<string>();
  const [podsLoading, setPodsLoading] = useState(false);

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

  const pod = pods.find((p) => p.name === podName);
  const container = containerParam || defaultContainer(pod);

  const target = useMemo<PodTarget | undefined>(
    () => (clusterId && podName && container ? { clusterId, namespace, pod: podName, container } : undefined),
    [clusterId, namespace, podName, container],
  );

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!clusterId) {
      return;
    }
    let cancelled = false;
    setPodsLoading(true);
    setPodsError(undefined);
    podFiles
      .listPods(clusterId, namespace)
      .then(
        (result) => !cancelled && setPods(result),
        (error) => {
          if (!cancelled) {
            setPods([]);
            setPodsError(message(error));
          }
        },
      )
      .finally(() => !cancelled && setPodsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clusterId, namespace]);

  useEffect(() => {
    setSelected(new Set());
    if (!target) {
      setListing(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setListingError(undefined);
    podFiles
      .listDirectory(target, pathParam)
      .then(
        (result) => {
          if (!cancelled) {
            setListing(result);
            setPathInput(result.path);
          }
        },
        (error) => {
          if (!cancelled) {
            setListingError(message(error));
            setPathInput(pathParam);
          }
        },
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [target, pathParam, reloadKey]);

  const currentPath = listing?.path ?? pathParam;

  const visibleEntries = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const entries = (listing?.entries ?? []).filter(
      (entry) => (showHidden || !entry.name.startsWith(".")) && (!needle || entry.name.toLowerCase().includes(needle)),
    );
    return sortEntries(entries, sort.column, sort.descending);
  }, [listing, showHidden, filter, sort]);

  // `PageParam.set()` builds the URL from the history's search params, which follow the location only once the
  // outermost mobx action ends, and the host's `Select` calls `onChange` inside an action. Several `set()` calls in a
  // row therefore each start from the old URL, and the last one wins. `setRaw` and `clear` change the search params
  // themselves, so the changes add up, and the host pushes one history entry for all of them.
  const updateParams = (values: Partial<Record<PodFilesPageParam, string>>) =>
    runInAction(() => {
      for (const [name, value] of Object.entries(values) as [PodFilesPageParam, string][]) {
        const param = params[name];
        if (!param) {
          continue;
        }
        if (value) {
          param.setRaw(value);
        } else {
          param.clear();
        }
      }
    });

  const navigateTo = (path: string) => updateParams({ path });

  const selectNamespace = (value: string) => updateParams({ namespace: value, pod: "", container: "", path: "" });

  const selectPod = (value: string) => updateParams({ pod: value, container: "", path: "" });

  const selectContainer = (value: string) => updateParams({ container: value, path: "" });

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

  const upload = async () => {
    if (!target) {
      return;
    }
    try {
      const files = await podFiles.pickUploadFiles();
      if (files.length === 0 || !(await confirmOverwrite(files.map((file) => file.name)))) {
        return;
      }
      await run(
        "Uploading",
        () =>
          podFiles.uploadFiles(
            target,
            currentPath,
            files.map((file) => file.path),
          ),
        files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`,
      );
    } catch (error) {
      Notifications.error(message(error));
    }
  };

  const uploadDropped = async (files: File[]) => {
    if (!target || files.length === 0) {
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
    await run(
      "Uploading",
      async () => {
        for (const file of files) {
          await podFiles.uploadData(target, joinPath(currentPath, file.name), new Uint8Array(await file.arrayBuffer()));
        }
      },
      files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`,
    );
  };

  const download = async (entries: FileEntry[]) => {
    if (!target || entries.length === 0) {
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
    if (!target || entries.length === 0) {
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

  const rename = (entry: FileEntry) => {
    if (!target) {
      return;
    }
    setPrompt({
      title: `Rename ${entry.name}`,
      label: "New name",
      initialValue: entry.name,
      submitLabel: "Rename",
      onSubmit: async (name) => {
        await podFiles.rename(target, joinPath(currentPath, entry.name), joinPath(currentPath, name));
        reload();
      },
    });
  };

  const createDirectory = () => {
    if (!target) {
      return;
    }
    setPrompt({
      title: `New folder in ${currentPath}`,
      label: "Folder name",
      submitLabel: "Create",
      onSubmit: async (name) => {
        await podFiles.makeDirectory(target, joinPath(currentPath, name));
        reload();
      },
    });
  };

  const createFile = () => {
    if (!target) {
      return;
    }
    setPrompt({
      title: `New file in ${currentPath}`,
      label: "File name",
      submitLabel: "Create",
      onSubmit: async (name) => {
        const path = joinPath(currentPath, name);
        await podFiles.createFile(target, path);
        reload();
        setEditing(path);
      },
    });
  };

  const open = (entry: FileEntry) => {
    const path = joinPath(currentPath, entry.name);
    if (isDirectoryLike(entry)) {
      navigateTo(path);
    } else if (entry.kind === "file" || entry.kind === "symlink") {
      setEditing(path);
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

  if (!clusterId) {
    return <div className={styles.empty}>No active cluster.</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.selector}>
          <span>Namespace</span>
          <NamespaceSelect
            id="pod-files-namespace"
            value={namespace}
            onChange={(option) => option && selectNamespace(option.value)}
          />
        </div>
        <div className={styles.selector}>
          <span>Pod</span>
          <Select
            id="pod-files-pod"
            value={podName || null}
            isLoading={podsLoading}
            placeholder={podsLoading ? "Loading pods..." : "Select a pod"}
            options={pods.map((p) => ({ value: p.name, label: `${p.name} (${p.phase})` }))}
            onChange={(option) => option && selectPod(option.value)}
          />
        </div>
        <div className={styles.selector}>
          <span>Container</span>
          <Select
            id="pod-files-container"
            value={container || null}
            isDisabled={!pod}
            options={(pod?.containers ?? []).map((c) => ({
              value: c.name,
              label: `${c.name}${c.init ? " (init)" : ""}${c.running ? "" : " - not running"}`,
            }))}
            onChange={(option) => option && selectContainer(option.value)}
          />
        </div>
      </div>

      {podsError ? <div className={styles.error}>{podsError}</div> : null}

      {!target ? (
        <div className={styles.empty}>
          {podName && !podsLoading && !pod
            ? `Pod ${podName} not found in ${namespace}.`
            : "Select a pod to browse its files."}
        </div>
      ) : (
        <>
          <div className={styles.pathBar}>
            <Icon
              material="arrow_upward"
              interactive
              tooltip="Parent folder"
              onClick={() => navigateTo(parentPath(currentPath))}
            />
            <Icon material="home" interactive tooltip="Working directory" onClick={() => navigateTo("")} />
            <div className={styles.breadcrumbs}>
              <button type="button" className={styles.crumb} onClick={() => navigateTo("/")}>
                /
              </button>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.path} className={styles.crumbGroup}>
                  <button type="button" className={styles.crumb} onClick={() => navigateTo(crumb.path)}>
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
              onSubmit={(value) => navigateTo(value.trim())}
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
              label={`Download${selectedEntries.length ? ` (${selectedEntries.length})` : ""}`}
              onClick={() => void download(selectedEntries)}
              disabled={!!busy || selectedEntries.length === 0}
            />
            <Button
              plain
              label={`Delete${selectedEntries.length ? ` (${selectedEntries.length})` : ""}`}
              onClick={() => void remove(selectedEntries)}
              disabled={!!busy || selectedEntries.length === 0}
            />
            <Checkbox label="Hidden files" value={showHidden} onChange={(value) => setShowHidden(value)} />
            <Input
              className={styles.filter}
              value={filter}
              onChange={(value) => setFilter(value)}
              placeholder="Filter"
            />
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
            ) : (
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
                    <th className={styles.sortable} onClick={() => sortBy("modified")}>
                      Modified {sortIndicator("modified")}
                    </th>
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
                      <td className={styles.name}>
                        <Icon
                          small
                          material={
                            entry.kind === "symlink"
                              ? entry.targetIsDirectory
                                ? "folder_special"
                                : "link"
                              : entry.kind === "directory"
                                ? "folder"
                                : entry.kind === "other"
                                  ? "device_unknown"
                                  : "description"
                          }
                        />
                        <button type="button" className={styles.entryLink} onClick={() => open(entry)}>
                          {entry.name}
                        </button>
                        {entry.linkTarget ? <span className={styles.linkTarget}> -&gt; {entry.linkTarget}</span> : null}
                      </td>
                      <td className={styles.number}>{isDirectoryLike(entry) ? "" : formatSize(entry.size)}</td>
                      <td>{formatTime(entry.modified)}</td>
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
                        <Icon small material="edit" interactive tooltip="Rename" onClick={() => rename(entry)} />
                        <Icon
                          small
                          material="delete"
                          interactive
                          tooltip="Delete"
                          onClick={() => void remove([entry])}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {listing && visibleEntries.length === 0 && !listingError ? (
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
        </>
      )}

      <NamePromptDialog prompt={prompt} onClose={() => setPrompt(undefined)} />
    </div>
  );
});
