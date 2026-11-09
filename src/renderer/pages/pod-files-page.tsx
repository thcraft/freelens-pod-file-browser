import { type Common, Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import styles from "./pod-files-page.module.scss";
import { PodTab, type TabLocation } from "./pod-tab";

const { Icon, Tab, Tabs } = Renderer.Component;

export const podFilesPageId = "pod-files";

// The first tab keeps its location in params of its own, which "Browse files" and the pod details open with a single
// tab. `first` is its id, `tabs` the other tabs as a JSON array, and `tab` the id of the active tab; an empty
// `first` or `tab` stands for the default id of the first tab.
export const podFilesPageParams = {
  namespace: "",
  pod: "",
  container: "",
  path: "",
  first: "",
  tabs: "",
  tab: "",
};

type PodFilesPageParam = keyof typeof podFilesPageParams;

export type PodFilesPageProps = Common.Types.PageComponentProps;

const FIRST_TAB_ID = "first";

interface PageTab extends TabLocation {
  /** Keeps the state of a tab, such as its selection, when another tab opens or closes. */
  id: string;
}

// The host keeps the params of a page for the life of the frame, keyed by extension and page id, so after the
// extension is updated in place the page still gets the params of the version that loaded first. A param that version
// did not declare is created here, once per frame.
const createdParams = new Map<PodFilesPageParam, Renderer.Navigation.PageParam<string>>();

function pageParam(params: PodFilesPageProps["params"], name: PodFilesPageParam) {
  const registered = params[name] as Renderer.Navigation.PageParam<string> | undefined;
  if (registered) {
    return registered;
  }
  let created = createdParams.get(name);
  if (!created) {
    created = Renderer.Navigation.createPageParam({ name, defaultValue: podFilesPageParams[name] });
    createdParams.set(name, created);
  }
  return created;
}

function newTabId() {
  return Math.random().toString(36).slice(2, 10);
}

function isPageTab(value: unknown): value is PageTab {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tab = value as Record<string, unknown>;
  return ["id", "namespace", "pod", "container", "path"].every((key) => typeof tab[key] === "string");
}

/** The other tabs from the `tabs` param; anything that is not one, or repeats an id, from an edited URL is left out. */
function parseTabs(raw: string, firstId: string): PageTab[] {
  if (!raw) {
    return [];
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    const ids = new Set([firstId]);
    return value.filter(isPageTab).filter((tab) => {
      const unique = !ids.has(tab.id);
      ids.add(tab.id);
      return unique;
    });
  } catch {
    return [];
  }
}

function tabLabel(tab: TabLocation) {
  return tab.pod ? `${tab.pod}${tab.container ? ` / ${tab.container}` : ""}` : "New tab";
}

export const PodFilesPage = observer(({ params }: PodFilesPageProps) => {
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;

  const param = (name: PodFilesPageParam) => pageParam(params, name).get() ?? "";
  const first: PageTab = {
    id: param("first") || FIRST_TAB_ID,
    namespace: param("namespace"),
    pod: param("pod"),
    container: param("container"),
    path: param("path"),
  };
  const tabs = [first, ...parseTabs(param("tabs"), first.id)];
  const active = tabs.find((tab) => tab.id === param("tab"))?.id ?? first.id;

  // `PageParam.set()` builds the URL from the history's search params, which follow the location only once the
  // outermost mobx action ends, and the host's `Select` calls `onChange` inside an action. Several `set()` calls in a
  // row therefore each start from the old URL, and the last one wins. `setRaw` and `clear` change the search params
  // themselves, so the changes add up, and the host pushes one history entry for all of them.
  const updateParams = (values: Partial<Record<PodFilesPageParam, string>>) =>
    runInAction(() => {
      for (const [name, value] of Object.entries(values) as [PodFilesPageParam, string][]) {
        if (value) {
          pageParam(params, name).setRaw(value);
        } else {
          pageParam(params, name).clear();
        }
      }
    });

  const setTabs = (next: PageTab[], activeId: string) => {
    const [head, ...rest] = next;
    updateParams({
      namespace: head.namespace,
      pod: head.pod,
      container: head.container,
      path: head.path,
      first: head.id === FIRST_TAB_ID ? "" : head.id,
      tabs: rest.length > 0 ? JSON.stringify(rest) : "",
      tab: activeId === head.id ? "" : activeId,
    });
  };

  const change = (id: string, values: Partial<TabLocation>) =>
    setTabs(
      tabs.map((tab) => (tab.id === id ? { ...tab, ...values } : tab)),
      active,
    );

  // A new tab opens at the end, in the namespace of the active one.
  const add = () => {
    const namespace = tabs.find((tab) => tab.id === active)?.namespace ?? "";
    const tab: PageTab = { id: newTabId(), namespace, pod: "", container: "", path: "" };
    setTabs([...tabs, tab], tab.id);
  };

  // Closing the active tab activates the one after it, or the one before it when it was the last.
  const close = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next, id === active ? (next[index] ?? next[index - 1]).id : active);
  };

  const select = (id: string) => updateParams({ tab: id === first.id ? "" : id });

  if (!clusterId) {
    return <div className={styles.empty}>No active cluster.</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.tabBar}>
        <Tabs className={styles.tabs} scrollable value={active} onChange={select}>
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={
                <span className={styles.tabLabel} title={`${tab.namespace || "default"} / ${tabLabel(tab)}`}>
                  {tabLabel(tab)}
                  {tabs.length > 1 ? (
                    <Icon
                      small
                      material="close"
                      interactive
                      tooltip="Close tab"
                      onClick={(event) => {
                        event.stopPropagation();
                        close(tab.id);
                      }}
                    />
                  ) : null}
                </span>
              }
            />
          ))}
        </Tabs>
        <Icon material="add" interactive tooltip="New tab" onClick={add} />
      </div>
      {tabs.map((tab) => (
        <PodTab
          key={tab.id}
          id={tab.id}
          clusterId={clusterId}
          location={tab}
          onChange={(values) => change(tab.id, values)}
          hidden={tab.id !== active}
        />
      ))}
    </div>
  );
});
