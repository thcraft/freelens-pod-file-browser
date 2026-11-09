import { type Common, Renderer } from "@freelensapp/extensions";
import { podFilesPageId, podFilesPageValues } from "../pages/pod-files-page";

const { Icon, MenuItem } = Renderer.Component;

type Pod = Renderer.K8sApi.Pod;

export interface PodFilesMenuItemProps extends Common.Types.KubeObjectMenuItemProps<Pod> {
  extension: Renderer.LensExtension;
}

export function PodFilesMenuItem({ object, toolbar, extension }: PodFilesMenuItemProps) {
  if (!object) {
    return null;
  }
  const containers = object.getRunningContainers();
  const container = containers[0]?.name ?? object.getContainers()[0]?.name ?? "";

  const open = () =>
    extension.navigate(
      podFilesPageId,
      podFilesPageValues({ namespace: object.getNs() ?? "", pod: object.getName(), container, path: "" }),
    );

  return (
    <MenuItem onClick={() => void open()}>
      <Icon material="folder_open" interactive={toolbar} tooltip={toolbar ? "Browse files" : undefined} />
      <span className="title">Browse files</span>
    </MenuItem>
  );
}
