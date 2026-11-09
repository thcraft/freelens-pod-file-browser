import { type Common, Renderer } from "@freelensapp/extensions";
import { runInAction } from "mobx";
import { observer } from "mobx-react";
import { useEffect, useRef } from "react";
import styles from "./pod-files-page.module.scss";
import { PodTab, type TabLocation } from "./pod-tab";

const { Icon, Tab, Tabs } = Renderer.Component;

export const podFilesPageId = "pod-files";

// The first tab keeps its location in params of its own. `first` is its id, `tabs` the other tabs as a JSON array,
// and `tab` the id of the active tab; an empty `first` or `tab` stands for the default id of the first tab.
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

type PodFilesPageValues = Record<PodFilesPageParam, string>;

export type PodFilesPageProps = Common.Types.PageComponentProps;

const FIRST_TAB_ID = "first";

/** Pod names longer than this are shortened in the middle on their tab, where the generated suffix stays visible. */
const MAX_TAB_LABEL = 32;

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

// The params of the page as it last showed them, in this cluster's frame. "Browse files" opens a pod in a tab next to
// these, and the page opened without params, from the sidebar, shows them again.
let lastValues: PodFilesPageValues | undefined;

function isEmpty(values: PodFilesPageValues) {
  return Object.values(values).every((value) => !value);
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

function tabsOf(values: PodFilesPageValues) {
  const first: PageTab = {
    id: values.first || FIRST_TAB_ID,
    namespace: values.namespace,
    pod: values.pod,
    container: values.container,
    path: values.path,
  };
  const tabs = [first, ...parseTabs(values.tabs, first.id)];
  const active = tabs.find((tab) => tab.id === values.tab)?.id ?? first.id;
  return { tabs, active };
}

function valuesOf(tabs: PageTab[], active: string): PodFilesPageValues {
  const [head, ...rest] = tabs;
  return {
    namespace: head.namespace,
    pod: head.pod,
    container: head.container,
    path: head.path,
    first: head.id === FIRST_TAB_ID ? "" : head.id,
    tabs: rest.length > 0 ? JSON.stringify(rest) : "",
    tab: active === head.id ? "" : active,
  };
}

/**
 * The params that open a pod on the page: in the tab that shows it already, or in a new tab after the others. An
 * empty container matches any, since a tab without one shows the default container.
 */
export function podFilesPageValues(location: TabLocation): PodFilesPageValues {
  const { tabs } = tabsOf(lastValues ?? podFilesPageParams);
  const shows = (tab: PageTab) =>
    (tab.namespace || "default") === (location.namespace || "default") &&
    tab.pod === location.pod &&
    (!tab.container || !location.container || tab.container === location.container);
  const existing = tabs.find(shows);
  if (existing) {
    return valuesOf(
      tabs.map((tab) => (tab === existing && location.path ? { ...tab, path: location.path } : tab)),
      existing.id,
    );
  }
  if (tabs.length === 1 && !tabs[0].pod) {
    return valuesOf([{ ...location, id: tabs[0].id }], tabs[0].id);
  }
  const tab: PageTab = { ...location, id: newTabId() };
  return valuesOf([...tabs, tab], tab.id);
}

function tabLabel(tab: TabLocation) {
  if (!tab.pod) {
    return "New tab";
  }
  if (tab.pod.length <= MAX_TAB_LABEL) {
    return tab.pod;
  }
  const end = Math.floor((MAX_TAB_LABEL - 1) / 2);
  return `${tab.pod.slice(0, MAX_TAB_LABEL - 1 - end)}…${tab.pod.slice(-end)}`;
}

function tabTitle(tab: TabLocation) {
  return [tab.namespace || "default", tab.pod, tab.container].filter(Boolean).join(" / ");
}

export const PodFilesPage = observer(({ params }: PodFilesPageProps) => {
  const clusterId = Renderer.Catalog.getActiveCluster()?.id;

  const values = Object.fromEntries(
    Object.keys(podFilesPageParams).map((name) => [name, pageParam(params, name as PodFilesPageParam).get() ?? ""]),
  ) as PodFilesPageValues;
  const { tabs, active } = tabsOf(values);

  // Opened without params, the page shows the tabs it last had, replacing the history entry so that Back does not
  // return to the empty page. Otherwise it remembers what it shows. Leaving the page changes the location before the
  // page unmounts, and mobx renders it once more with the params of the next page, which it must not remember.
  const mounted = useRef(false);
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (!window.location.pathname.endsWith(`/${podFilesPageId}`)) {
      return;
    }
    const current = JSON.parse(serialized) as PodFilesPageValues;
    if (!mounted.current) {
      mounted.current = true;
      if (isEmpty(current) && lastValues && !isEmpty(lastValues)) {
        for (const [name, value] of Object.entries(lastValues) as [PodFilesPageParam, string][]) {
          if (value) {
            pageParam(params, name).set(value, { replaceHistory: true });
          }
        }
        return;
      }
    }
    lastValues = current;
  }, [serialized, params]);

  // `PageParam.set()` builds the URL from the history's search params, which follow the location only once the
  // outermost mobx action ends, and the host's `Select` calls `onChange` inside an action. Several `set()` calls in a
  // row therefore each start from the old URL, and the last one wins. `setRaw` and `clear` change the search params
  // themselves, so the changes add up, and the host pushes one history entry for all of them.
  const setTabs = (next: PageTab[], activeId: string) =>
    runInAction(() => {
      for (const [name, value] of Object.entries(valuesOf(next, activeId)) as [PodFilesPageParam, string][]) {
        if (value) {
          pageParam(params, name).setRaw(value);
        } else {
          pageParam(params, name).clear();
        }
      }
    });

  const change = (id: string, location: Partial<TabLocation>) =>
    setTabs(
      tabs.map((tab) => (tab.id === id ? { ...tab, ...location } : tab)),
      active,
    );

  // A new tab opens at the end, in the namespace of the active one.
  const add = () => {
    const namespace = tabs.find((tab) => tab.id === active)?.namespace ?? "";
    const tab: PageTab = { id: newTabId(), namespace, pod: "", container: "", path: "" };
    setTabs([...tabs, tab], tab.id);
  };

  // Closing the active tab activates the one after it, or the one before it when it was the last. Closing the only
  // tab leaves a new, empty one in its namespace.
  const close = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    if (next.length === 0) {
      const tab: PageTab = { id: newTabId(), namespace: tabs[index].namespace, pod: "", container: "", path: "" };
      setTabs([tab], tab.id);
      return;
    }
    setTabs(next, id === active ? (next[index] ?? next[index - 1]).id : active);
  };

  const select = (id: string) => setTabs(tabs, id);

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
                <span className={styles.tabLabel} title={tabTitle(tab)}>
                  {tabLabel(tab)}
                  {tabs.length > 1 || tab.pod ? (
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
          onChange={(location) => change(tab.id, location)}
          hidden={tab.id !== active}
        />
      ))}
    </div>
  );
});
