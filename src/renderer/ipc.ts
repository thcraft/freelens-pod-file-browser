import { Renderer } from "@freelensapp/extensions";
import {
  type DirectoryListing,
  type DownloadItem,
  type DownloadResult,
  type FileAttributes,
  type FileContent,
  IpcChannel,
  type IpcResult,
  type LocalFile,
  type PodTarget,
  type TextEncoding,
  type UploadResult,
} from "../common/protocol";

import type { UpdateStatus } from "../common/updates";

export class PodFilesIpc extends Renderer.Ipc {}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await PodFilesIpc.getInstance().invoke(channel, ...args)) as IpcResult<T>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

export const podFiles = {
  listDirectory: (target: PodTarget, path: string) => invoke<DirectoryListing>(IpcChannel.listDirectory, target, path),
  readFile: (target: PodTarget, path: string, encoding: TextEncoding | undefined) =>
    invoke<FileContent>(IpcChannel.readFile, target, path, encoding),
  writeFile: (target: PodTarget, path: string, content: string, encoding: TextEncoding) =>
    invoke<void>(IpcChannel.writeFile, target, path, content, encoding),
  uploadData: (target: PodTarget, path: string, data: Uint8Array) =>
    invoke<void>(IpcChannel.uploadData, target, path, data),
  pickUploadFiles: () => invoke<LocalFile[]>(IpcChannel.pickUploadFiles),
  uploadFiles: (target: PodTarget, directory: string, files: string[]) =>
    invoke<UploadResult>(IpcChannel.uploadFiles, target, directory, files),
  download: (target: PodTarget, items: DownloadItem[], transferId: string) =>
    invoke<DownloadResult>(IpcChannel.download, target, items, transferId),
  createFile: (target: PodTarget, path: string) => invoke<void>(IpcChannel.createFile, target, path),
  makeDirectory: (target: PodTarget, path: string) => invoke<void>(IpcChannel.makeDirectory, target, path),
  rename: (target: PodTarget, from: string, to: string) => invoke<void>(IpcChannel.rename, target, from, to),
  remove: (target: PodTarget, paths: string[]) => invoke<void>(IpcChannel.remove, target, paths),
  setAttributes: (target: PodTarget, paths: string[], attributes: FileAttributes) =>
    invoke<void>(IpcChannel.setAttributes, target, paths, attributes),
  updateStatus: () => invoke<UpdateStatus>(IpcChannel.updateStatus),
  checkForUpdates: () => invoke<UpdateStatus>(IpcChannel.checkForUpdates),
  installUpdate: () => invoke<void>(IpcChannel.installUpdate),
};
