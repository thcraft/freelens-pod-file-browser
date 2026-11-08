import { Renderer } from "@freelensapp/extensions";
import {
  withDetailsErrorBoundary,
  withMenuItemErrorBoundary,
  withPageErrorBoundary,
} from "./components/error-boundary";
import { PodFilesDetails } from "./details/pod-files-details";
import { PodFilesIcon } from "./icons";
import { PodFilesIpc } from "./ipc";
import { PodFilesMenuItem } from "./menus/pod-files-menu-item";
import { PodFilesPage, podFilesPageId, podFilesPageParams } from "./pages/pod-files-page";

// Every page and menu item renders inside an error boundary, so that an error it throws stays in its place: the host
// has none around a menu item, and its boundary around the cluster frame would replace the whole cluster view.
export default class PodFileBrowserRenderer extends Renderer.LensExtension {
  async onActivate() {
    PodFilesIpc.createInstance(this);
  }

  clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: podFilesPageId,
      params: podFilesPageParams,
      components: {
        Page: PodFilesPage,
      },
    },
  ].map((registration) => withPageErrorBoundary(this, registration));

  clusterPageMenus = [
    {
      id: podFilesPageId,
      title: "Pod Files",
      target: { pageId: podFilesPageId },
      components: {
        Icon: PodFilesIcon,
      },
    },
  ];

  // After the host's own sections of the pod details: the host orders them by 300 - priority.
  kubeObjectDetailItems: Renderer.LensExtension["kubeObjectDetailItems"] = [
    Renderer.K8sApi.detailsFor(Renderer.K8sApi.Pod, {
      priority: 10,
      Details: (props) => <PodFilesDetails {...props} extension={this} />,
    }),
  ].map((registration) => withDetailsErrorBoundary(this, registration));

  kubeObjectMenuItems: Renderer.LensExtension["kubeObjectMenuItems"] = [
    Renderer.K8sApi.menuItemFor(Renderer.K8sApi.Pod, {
      MenuItem: (props) => <PodFilesMenuItem {...props} extension={this} />,
    }),
  ].map((registration) => withMenuItemErrorBoundary(this, registration));
}
