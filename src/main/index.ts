import { access } from "node:fs/promises";
import path from "node:path";
import { Main } from "@freelensapp/extensions";
import {
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import {
  type DownloadItem,
  type DownloadResult,
  type FileAttributes,
  IpcChannel,
  type IpcResult,
  isTextEncoding,
  joinPath,
  type LocalFile,
  type PodTarget,
  type UploadResult,
} from "../common/protocol";
import { SettingsStore } from "../common/settings-store";
import { localNameFor } from "./local-names";
import { PodFileSystem } from "./pod-fs";
import { UpdateChecker } from "./update-check";

class PodFilesIpc extends Main.Ipc {}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function windowOf(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function showOpenDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const window = windowOf(event);
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

function showSaveDialog(event: IpcMainInvokeEvent, options: SaveDialogOptions) {
  const window = windowOf(event);
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function uniqueLocalPath(directory: string, name: string) {
  const extension = name.endsWith(".tar.gz") ? ".tar.gz" : path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = path.join(directory, name);
  for (let i = 1; await exists(candidate); i++) {
    candidate = path.join(directory, `${stem} (${i})${extension}`);
  }
  return candidate;
}

export default class PodFileBrowserMain extends Main.LensExtension {
  private updates?: UpdateChecker;

  async onDeactivate() {
    this.updates?.stop();
  }

  async onActivate() {
    const settings = SettingsStore.getInstanceOrCreate<SettingsStore>();
    settings.loadExtension(this);
    this.updates?.stop();
    const updates = new UpdateChecker(this.version, settings);
    this.updates = updates;
    updates.start();

    const fs = new PodFileSystem(path.dirname(this.manifestPath));
    // The local files the user chose in the upload dialog. Main uploads only those, so that the renderer cannot have
    // it read any other file of the user's.
    const pickedFiles = new Set<string>();
    const ipc = PodFilesIpc.createInstance(this);

    // Every handler answers with an IpcResult, so that the renderer gets the
    // message as it was thrown rather than wrapped by Electron.
    const handle = <A extends unknown[], R>(
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: A) => Promise<R>,
    ) => {
      ipc.handle(channel, async (event, ...args): Promise<IpcResult<R>> => {
        try {
          return { ok: true, value: await handler(event, ...(args as A)) };
        } catch (error) {
          console.error(`[pod-file-browser] ${channel} failed:`, error);
          return { ok: false, error: toMessage(error) };
        }
      });
    };

    handle(IpcChannel.listDirectory, (_event, target: PodTarget, directory: string) =>
      fs.listDirectory(target, directory),
    );

    handle(IpcChannel.readFile, (_event, target: PodTarget, file: string, encoding: unknown) =>
      fs.readFile(target, file, isTextEncoding(encoding) ? encoding : undefined),
    );

    handle(
      IpcChannel.writeFile,
      async (_event, target: PodTarget, file: string, content: string, encoding: unknown) => {
        if (!isTextEncoding(encoding)) {
          throw new Error(`Unknown encoding ${String(encoding)}`);
        }
        await fs.writeText(target, file, content, encoding);
      },
    );

    handle(IpcChannel.uploadData, (_event, target: PodTarget, file: string, data: Uint8Array) =>
      fs.writeBytes(target, file, data),
    );

    handle(IpcChannel.createFile, (_event, target: PodTarget, file: string) => fs.createFile(target, file));

    handle(IpcChannel.makeDirectory, (_event, target: PodTarget, directory: string) =>
      fs.makeDirectory(target, directory),
    );

    handle(IpcChannel.rename, (_event, target: PodTarget, from: string, to: string) => fs.rename(target, from, to));

    handle(IpcChannel.remove, (_event, target: PodTarget, paths: string[]) => fs.remove(target, paths));

    handle(IpcChannel.setAttributes, (_event, target: PodTarget, paths: string[], attributes: FileAttributes) =>
      fs.setAttributes(target, paths, attributes),
    );

    handle(IpcChannel.updateStatus, async () => updates.status());

    handle(IpcChannel.checkForUpdates, () => updates.check());

    handle(IpcChannel.installUpdate, () => updates.install());

    handle(IpcChannel.pickUploadFiles, async (event): Promise<LocalFile[]> => {
      const result = await showOpenDialog(event, {
        title: "Upload files to the container",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) {
        return [];
      }
      for (const file of result.filePaths) {
        pickedFiles.add(file);
      }
      return result.filePaths.map((file) => ({ path: file, name: path.basename(file) }));
    });

    handle(
      IpcChannel.uploadFiles,
      async (_event, target: PodTarget, directory: string, files: string[]): Promise<UploadResult> => {
        const unpicked = files.find((file) => !pickedFiles.has(file));
        if (unpicked !== undefined) {
          throw new Error(`${unpicked} was not chosen in the upload dialog`);
        }
        const uploaded: string[] = [];
        for (const file of files) {
          pickedFiles.delete(file);
          const remotePath = joinPath(directory, path.basename(file));
          await fs.uploadLocalFile(target, file, remotePath);
          uploaded.push(remotePath);
        }
        return { uploaded };
      },
    );

    handle(IpcChannel.download, async (event, target: PodTarget, items: DownloadItem[]): Promise<DownloadResult> => {
      const download = (item: DownloadItem, localPath: string) =>
        item.isDirectory
          ? fs.downloadDirectory(target, item.path, localPath)
          : fs.downloadFile(target, item.path, localPath);

      if (items.length === 1) {
        const [item] = items;
        const result = await showSaveDialog(event, {
          title: item.isDirectory ? `Save ${item.path} as a .tar.gz archive` : `Save ${item.path}`,
          defaultPath: localNameFor(item),
        });
        if (result.canceled || !result.filePath) {
          return { saved: [] };
        }
        await download(item, result.filePath);
        return { saved: [result.filePath] };
      }

      const result = await showOpenDialog(event, {
        title: `Save ${items.length} items to a folder`,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { saved: [] };
      }
      const saved: string[] = [];
      for (const item of items) {
        const localPath = await uniqueLocalPath(result.filePaths[0], localNameFor(item));
        await download(item, localPath);
        saved.push(localPath);
      }
      return { saved };
    });
  }
}
