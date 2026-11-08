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
  baseName,
  type DownloadItem,
  type DownloadResult,
  IpcChannel,
  type IpcResult,
  joinPath,
  type LocalFile,
  type PodTarget,
  type UploadResult,
} from "../common/protocol";
import { PodFileSystem } from "./pod-fs";

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

function localNameFor(item: DownloadItem) {
  const name = baseName(item.path).replace(/[<>:"\\|?*]/g, "_");
  return item.isDirectory ? `${name === "/" ? "root" : name}.tar.gz` : name;
}

export default class PodFileBrowserMain extends Main.LensExtension {
  async onActivate() {
    const fs = new PodFileSystem(path.dirname(this.manifestPath));
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

    handle(IpcChannel.listPods, (_event, clusterId: string, namespace: string) => fs.listPods(clusterId, namespace));

    handle(IpcChannel.listDirectory, (_event, target: PodTarget, directory: string) =>
      fs.listDirectory(target, directory),
    );

    handle(IpcChannel.readFile, (_event, target: PodTarget, file: string) => fs.readFile(target, file));

    handle(IpcChannel.writeFile, (_event, target: PodTarget, file: string, content: string) =>
      fs.writeFile(target, file, content),
    );

    handle(IpcChannel.uploadData, (_event, target: PodTarget, file: string, data: Uint8Array) =>
      fs.writeFile(target, file, data),
    );

    handle(IpcChannel.createFile, (_event, target: PodTarget, file: string) => fs.createFile(target, file));

    handle(IpcChannel.makeDirectory, (_event, target: PodTarget, directory: string) =>
      fs.makeDirectory(target, directory),
    );

    handle(IpcChannel.rename, (_event, target: PodTarget, from: string, to: string) => fs.rename(target, from, to));

    handle(IpcChannel.remove, (_event, target: PodTarget, paths: string[]) => fs.remove(target, paths));

    handle(IpcChannel.pickUploadFiles, async (event): Promise<LocalFile[]> => {
      const result = await showOpenDialog(event, {
        title: "Upload files to the container",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) {
        return [];
      }
      return result.filePaths.map((file) => ({ path: file, name: path.basename(file) }));
    });

    handle(
      IpcChannel.uploadFiles,
      async (_event, target: PodTarget, directory: string, files: string[]): Promise<UploadResult> => {
        const uploaded: string[] = [];
        for (const file of files) {
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
