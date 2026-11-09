# Changelog

The release workflow copies the section of the released version into the GitHub release notes.
Add a section `## <version> (<date>)` and set the same version in `package.json` before tagging `v<version>`.

## 0.5.1 (2026-11-09)

- **Dialog titles show in the light theme.** The title of the editor, of Permissions and of the name prompts took the
  white colour that Freelens gives headings, and was invisible on the white dialog.
- **"1 item"** instead of "1 items" under a listing.
- **Screenshots in the README**, taken of demo pods in a local cluster.

## 0.5.0 (2026-11-09)

- **Tabs.** The "Pod Files" page opens as many tabs as you need, each with its own namespace, pod, container and
  folder: `+` opens a new tab in the namespace of the active one, the cross on a tab closes it (the last one leaves an
  empty tab). A tab in the background keeps its listing, selection and a running download. "Browse files" in the pod
  menu and the pod details open the pod in a new tab, or switch to the tab that shows it already, and the page opened
  from the sidebar shows the tabs it last had. The tabs are kept in the URL, so Back and Forward work as before.
- **Download progress stays in its tab.** Each browser shows the progress of its own download only.

## 0.4.1 (2026-11-09)

- **Large downloads no longer fail.** A file now downloads in chunks of 8 MiB, each checked and read again when its
  transfer breaks off, with the progress shown next to the toolbar. A proxy in front of the Kubernetes API server could
  cut one long transfer, and kubectl failed with "error reading from error stream: read message".
- **A cluster whose proxy breaks kubectl exec over WebSockets switches to SPDY.** When a transfer breaks off that way,
  it is repeated with the older SPDY transport, and that cluster keeps using it; this also helps uploads, folder
  downloads and the editor.

## 0.4.0 (2026-11-09)

- **Published on npm** as `@thcraft/freelens-pod-file-browser`: install it in Freelens by its name, or with the link
  `freelens://app/extensions/install/@thcraft/freelens-pod-file-browser`.
- **New version notifications.** Once a day the extension asks npm whether a newer version has been published and shows
  a system notification, once per version; click it and Freelens installs the new version after you confirm it. The
  preferences of the extension (_Pod File Browser updates_) turn it off, show the installed and the newest version,
  check right away and install it. The check sends nothing but the request for the newest version.

## 0.3.0 (2026-11-08)

- **Files in any text encoding.** The editor opens files as UTF-8 (UTF-16 by its byte order mark). A file that is not
  valid UTF-8 opens read only; pick its encoding in the editor header (Windows-1250, ISO-8859-2, CP852, Windows-1252,
  ISO-8859-1, ISO-8859-15, Windows-1251, KOI8-R, UTF-16) to edit it, and it is saved back in that encoding. A file that
  does not convert back to the same bytes stays read only, and characters the encoding cannot hold are refused on
  save, by name.
- **Large binary files open safely.** The editor reads the first 8 KiB, and a binary file is not read any further and
  is never editable. Text files are shown up to 2 MiB.
- **Interrupted transfers no longer damage files.** Uploads and saves go to a temporary file next to the target and
  replace its content only once every byte arrived; owner, mode and links of the file stay. A failed download no
  longer removes a local file you chose to replace.
- **No action on a stale listing.** While the listing of another container or folder loads, no action can run, and
  only one action runs at a time; row actions and drag and drop wait too.
- A symlink to a folder downloads as the folder it points to. New files never replace one that appeared meanwhile.
- After a cluster reconnects, operations work at once instead of failing for up to a minute.
- Quick operations give up after 60 seconds instead of waiting forever.
- Downloaded files get names Windows accepts (`CON`, `NUL`, trailing dots).
- The editor cannot be closed while it saves; the path bar works with the keyboard.

## 0.2.1 (2026-11-08)

- **One clickable path bar.** The current folder is shown once, as breadcrumbs: click a segment to open it, or click
  anywhere else in the bar to type a path (Enter opens it, Escape cancels).
- **Clearer "Change permissions" dialog.** Mode and owner are prefilled with the current values, help texts are below
  the fields, and a preview shows the `chown`/`chmod` that Apply runs.

## 0.2.0 (2026-11-08)

- **Files in the pod details.** The details of a pod have a "Files" section with the same browser, started only when
  you click "Browse files".
- **Change permissions.** `chmod` (octal or symbolic) and `chown` for the selected items or a single row, optionally
  recursive. Uploaded files are selected, so their permissions can be changed right away.
- The Pod Files page takes the pods from Freelens, the same list its Pods page shows.

## 0.1.0 (2026-11-08)

- First version: a "Pod Files" page in the cluster sidebar and "Browse files" in the pod menu.
- Browse the filesystem of any container of a pod, with sizes, times, permissions, owners and symlink targets.
- Download files, and folders as `.tar.gz`; upload files through a dialog or by drag and drop.
- Create folders and files, rename and delete; view and edit text files in the Monaco editor.
