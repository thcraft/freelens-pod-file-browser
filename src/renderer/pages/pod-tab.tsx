import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { FileBrowser } from "../components/file-browser";
import { containerLabel, defaultContainer, podContainers } from "../pod-containers";
import styles from "./pod-files-page.module.scss";

import type { PodTarget } from "../../common/protocol";

const { NamespaceSelect, Select } = Renderer.Component;

/** What one tab of the page shows; empty strings for what is not chosen. */
export interface TabLocation {
  namespace: string;
  pod: string;
  container: string;
  path: string;
}

export interface PodTabProps {
  /** Makes the ids of the selects unique on the page. */
  id: string;
  clusterId: string;
  location: TabLocation;
  onChange: (values: Partial<TabLocation>) => void;
  /** A tab that is not active stays mounted, hidden, so that it keeps its listing, selection and a running action. */
  hidden: boolean;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const PodTab = observer(({ id, clusterId, location, onChange, hidden }: PodTabProps) => {
  // Read here rather than when the module loads: the renderer entry loads in the root frame too, which has no
  // cluster and no pod store.
  const { podsStore } = Renderer.K8sApi;
  const namespace = location.namespace || "default";
  const podName = location.pod;

  const [podsError, setPodsError] = useState<string>();
  const [podsLoading, setPodsLoading] = useState(false);
  const [podsReloadKey, setPodsReloadKey] = useState(0);

  // The pods come from the host's store, the same objects its Pods page and the pod details show. Read while
  // rendering, they follow the store's updates of the observable items.
  const pods = podsStore
    .getAllByNs(namespace)
    .slice()
    .sort((a, b) => a.getName().localeCompare(b.getName()));
  const pod = pods.find((p) => p.getName() === podName);
  const containers = pod ? podContainers(pod) : [];
  const container = location.container || defaultContainer(containers);

  const target = useMemo<PodTarget | undefined>(
    () => (podName && container ? { clusterId, namespace, pod: podName, container } : undefined),
    [clusterId, namespace, podName, container],
  );

  // Loads the pods of the namespace into the host's store. `merge` replaces those of this namespace only and keeps
  // what other views and tabs loaded. The controller is created in the effect, so that the cleanup of a StrictMode
  // run aborts only its own request; the store takes an aborted load for no failure.
  useEffect(() => {
    const controller = new AbortController();
    setPodsLoading(true);
    setPodsError(undefined);
    podsStore
      .loadAll({
        namespaces: [namespace],
        merge: true,
        reqInit: { signal: controller.signal },
        onLoadFailure: (error) => {
          if (!controller.signal.aborted) {
            setPodsError(message(error instanceof Error && error.cause ? error.cause : error));
          }
        },
      })
      .finally(() => !controller.signal.aborted && setPodsLoading(false));
    return () => controller.abort();
  }, [namespace, podsReloadKey]);

  return (
    <div className={`${styles.tab} ${hidden ? styles.hidden : ""}`}>
      <div className={styles.toolbar}>
        <div className={styles.selector}>
          <span>Namespace</span>
          <NamespaceSelect
            id={`pod-files-namespace-${id}`}
            value={namespace}
            onChange={(option) => option && onChange({ namespace: option.value, pod: "", container: "", path: "" })}
          />
        </div>
        <div className={styles.selector}>
          <span>Pod</span>
          <Select
            id={`pod-files-pod-${id}`}
            value={podName || null}
            isLoading={podsLoading}
            placeholder={podsLoading ? "Loading pods..." : "Select a pod"}
            options={pods.map((p) => ({ value: p.getName(), label: `${p.getName()} (${p.getStatusMessage()})` }))}
            onMenuOpen={() => setPodsReloadKey((key) => key + 1)}
            onChange={(option) => option && onChange({ pod: option.value, container: "", path: "" })}
          />
        </div>
        <div className={styles.selector}>
          <span>Container</span>
          <Select
            id={`pod-files-container-${id}`}
            value={container || null}
            isDisabled={!pod}
            options={containers.map((c) => ({ value: c.name, label: containerLabel(c) }))}
            onChange={(option) => option && onChange({ container: option.value, path: "" })}
          />
        </div>
      </div>

      {podsError ? <div className={styles.error}>{podsError}</div> : null}

      {target ? (
        <FileBrowser target={target} path={location.path} onNavigate={(path) => onChange({ path })} />
      ) : (
        <div className={styles.empty}>
          {podName && !podsLoading && !pod
            ? `Pod ${podName} not found in ${namespace}.`
            : "Select a pod to browse its files."}
        </div>
      )}
    </div>
  );
});
