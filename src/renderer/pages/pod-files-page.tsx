import { type Common, Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { FileBrowser } from "../components/file-browser";
import { containerLabel, defaultContainer, podContainers } from "../pod-containers";
import styles from "./pod-files-page.module.scss";

import type { PodTarget } from "../../common/protocol";

const { NamespaceSelect, Select } = Renderer.Component;

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

export const PodFilesPage = observer(({ params }: PodFilesPageProps) => {
  // Read here rather than when the module loads: the renderer entry loads in the root frame too, which has no
  // cluster and no pod store.
  const { podsStore } = Renderer.K8sApi;
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;
  const namespace = (params.namespace?.get() as string | undefined) || "default";
  const podName = (params.pod?.get() as string | undefined) ?? "";
  const containerParam = (params.container?.get() as string | undefined) ?? "";
  const pathParam = (params.path?.get() as string | undefined) ?? "";

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
  const container = containerParam || defaultContainer(containers);

  const target = useMemo<PodTarget | undefined>(
    () => (clusterId && podName && container ? { clusterId, namespace, pod: podName, container } : undefined),
    [clusterId, namespace, podName, container],
  );

  // Loads the pods of the namespace into the host's store. `merge` replaces those of this namespace only and keeps
  // what other views loaded. The controller is created in the effect, so that the cleanup of a StrictMode run aborts
  // only its own request; the store takes an aborted load for no failure.
  useEffect(() => {
    if (!clusterId) {
      return;
    }
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
  }, [clusterId, namespace, podsReloadKey]);

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
            onChange={(option) => option && updateParams({ namespace: option.value, pod: "", container: "", path: "" })}
          />
        </div>
        <div className={styles.selector}>
          <span>Pod</span>
          <Select
            id="pod-files-pod"
            value={podName || null}
            isLoading={podsLoading}
            placeholder={podsLoading ? "Loading pods..." : "Select a pod"}
            options={pods.map((p) => ({ value: p.getName(), label: `${p.getName()} (${p.getStatusMessage()})` }))}
            onMenuOpen={() => setPodsReloadKey((key) => key + 1)}
            onChange={(option) => option && updateParams({ pod: option.value, container: "", path: "" })}
          />
        </div>
        <div className={styles.selector}>
          <span>Container</span>
          <Select
            id="pod-files-container"
            value={container || null}
            isDisabled={!pod}
            options={containers.map((c) => ({ value: c.name, label: containerLabel(c) }))}
            onChange={(option) => option && updateParams({ container: option.value, path: "" })}
          />
        </div>
      </div>

      {podsError ? <div className={styles.error}>{podsError}</div> : null}

      {target ? (
        <FileBrowser target={target} path={pathParam} onNavigate={(path) => updateParams({ path })} />
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
