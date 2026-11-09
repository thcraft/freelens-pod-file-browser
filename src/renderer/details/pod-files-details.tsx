import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { FileBrowser } from "../components/file-browser";
import { podFilesPageId, podFilesPageValues } from "../pages/pod-files-page";
import { containerLabel, defaultContainer, podContainers } from "../pod-containers";
import styles from "./pod-files-details.module.scss";

import type { PodTarget } from "../../common/protocol";

const { Button, DrawerTitle, Icon, Select } = Renderer.Component;

type Pod = Renderer.K8sApi.Pod;

export interface PodFilesDetailsProps extends Renderer.Component.KubeObjectDetailsProps<Pod> {
  extension: Renderer.LensExtension;
}

/**
 * The file browser as a section of the pod details. It runs nothing in the container until it is opened, so that
 * showing the details of a pod costs no exec.
 */
export const PodFilesDetails = observer(({ object, extension }: PodFilesDetailsProps) => {
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;
  const uid = object.getId();
  const namespace = object.getNs() ?? "";
  const podName = object.getName();
  const containers = podContainers(object);

  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState("");
  const [path, setPath] = useState("");

  // The host keeps the panel mounted while the drawer shows another pod.
  useEffect(() => {
    setOpen(false);
    setContainer("");
    setPath("");
  }, [uid]);

  const selectedContainer = container || defaultContainer(containers);

  const target = useMemo<PodTarget | undefined>(
    () =>
      clusterId && selectedContainer ? { clusterId, namespace, pod: podName, container: selectedContainer } : undefined,
    [clusterId, namespace, podName, selectedContainer],
  );

  const openPage = () =>
    void extension.navigate(
      podFilesPageId,
      podFilesPageValues({ namespace, pod: podName, container: selectedContainer, path }),
    );

  return (
    <div className={styles.details}>
      <DrawerTitle>
        <span className={styles.title}>
          Files
          <Icon small material="open_in_new" interactive tooltip="Open in Pod Files" onClick={openPage} />
        </span>
      </DrawerTitle>
      {!target ? (
        <p className={styles.notice}>The pod has no container.</p>
      ) : !open ? (
        <div className={styles.closed}>
          <Button primary label="Browse files" onClick={() => setOpen(true)} />
          <span className={styles.notice}>Lists, downloads, uploads and edits files in a container of this pod.</span>
        </div>
      ) : (
        <>
          {containers.length > 1 ? (
            <div className={styles.container}>
              <span>Container</span>
              <Select
                id="pod-files-details-container"
                value={selectedContainer}
                options={containers.map((c) => ({ value: c.name, label: containerLabel(c) }))}
                onChange={(option) => {
                  if (option) {
                    setContainer(option.value);
                    setPath("");
                  }
                }}
              />
            </div>
          ) : null}
          <FileBrowser target={target} path={path} onNavigate={setPath} compact />
        </>
      )}
    </div>
  );
});
