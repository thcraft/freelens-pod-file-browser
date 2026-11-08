import type { Renderer } from "@freelensapp/extensions";

import type { PodContainerInfo } from "../common/protocol";

type Pod = Renderer.K8sApi.Pod;

/** The containers of a pod object from the host's store, init and ephemeral ones included. */
export function podContainers(pod: Pod): PodContainerInfo[] {
  const statuses = [
    ...(pod.status?.containerStatuses ?? []),
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.ephemeralContainerStatuses ?? []),
  ];
  const isRunning = (name: string) =>
    statuses.some((status) => status.name === name && status.state?.running !== undefined);

  return [
    ...pod.getContainers().map((c) => ({ name: c.name, running: isRunning(c.name), init: false })),
    ...pod.getEphemeralContainers().map((c) => ({ name: c.name, running: isRunning(c.name), init: false })),
    ...pod.getInitContainers().map((c) => ({ name: c.name, running: isRunning(c.name), init: true })),
  ];
}

export function defaultContainer(containers: PodContainerInfo[]): string {
  return (containers.find((c) => c.running && !c.init) ?? containers.find((c) => !c.init) ?? containers[0])?.name ?? "";
}

export function containerLabel(container: PodContainerInfo): string {
  return `${container.name}${container.init ? " (init)" : ""}${container.running ? "" : " - not running"}`;
}
