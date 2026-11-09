# Pod File Browser for Freelens

**The files of a container, one click from the pod.** Pod File Browser is an extension for
[Freelens](https://freelens.app), the free Kubernetes IDE, that lets you browse the filesystem of any container of a pod,
download and upload files, edit text files and change their permissions, without typing `kubectl cp` or
`kubectl exec`.

## Why

Freelens shows pods, logs and a shell, but getting a file in or out of a container still means a terminal:
`kubectl cp` needs `tar` in the container and the exact path, and looking around first means an interactive shell.
Pod File Browser puts the filesystem next to the pod: open it from the pod menu or the pod details, click through the
folders, and drag files in or save them out.

## Features

- **Where you need it.** A "Pod Files" page in the cluster sidebar (namespace, pod and container pickers, kept in the
  URL so Back works), a "Browse files" item in the pod menu, and a "Files" section in the pod details. All three are
  the same browser.
- **Tabs.** The page opens as many tabs as you need, each with its own namespace, pod, container and folder.
- **Browse.** Sizes, modification times, permissions, owners and symlink targets; sorting, filter and hidden files.
  Click a segment of the path to go there, or click the path bar to type a path.
- **Download** files, and folders as `.tar.gz`; several items at once into a folder.
- **Upload** through a file dialog or by dropping files on the listing. Existing files are only replaced after you
  confirm, and an upload that breaks off leaves the file in the container as it was.
- **Edit text files** (up to 2 MiB) in the Monaco editor of Freelens. Files open as UTF-8; a file in another encoding
  opens read only until you pick its encoding (Windows-1250, ISO-8859-2, CP852, Windows-1252, ISO-8859-1,
  ISO-8859-15, Windows-1251, KOI8-R, UTF-16), and is then saved back in it. Binary files are recognised from their
  first bytes and never opened for editing.
- **Change permissions:** `chmod` (octal such as `644`, or symbolic such as `u+x`) and `chown` (`user:group`), for the
  selected items or one row, optionally recursive. Uploaded files are selected, so their permissions can be set right
  away.
- **New folder, new file, rename, delete** (with confirmation).
- **Init and ephemeral containers** are listed too, so a debug container can be browsed.
- **New version notifications.** Once a day the extension asks npm whether a newer version has been published and
  shows a system notification, once per version; click it and Freelens installs the new version after you confirm it.
  Turn it off in the Freelens preferences of the extension (_Pod File Browser updates_), where you also see the
  installed and the newest version, check right away and install it.

## Requirements

- Freelens 2.0 or newer (extension API v2).
- A **POSIX shell (`sh`) in the container**. Every operation runs a small script through `kubectl exec … -- sh -c`,
  written to work with BusyBox as well as a full userland. Images without a shell, such as distroless ones, cannot be
  browsed; attach an ephemeral debug container with a shell to the pod and browse that one instead.
- `stat` for sizes, times and permissions (the listing works without it, with names only), `tar` for downloading
  folders, `mktemp` for safe uploads (without it, data is written into the file directly and checked afterwards).
- Kubernetes permissions to list pods and to create `pods/exec` in the namespace. Changing the owner usually needs the
  container to run as root.

## Install

Open Freelens and go to **Extensions** (`Ctrl`+`Shift`+`E`, on macOS `Cmd`+`Shift`+`E`). The field at the top takes
the name of a package, the URL of a tarball, or the path to a tarball or a directory.

### From npm

Enter `@thcraft/freelens-pod-file-browser` and press **Install**, or open this link, which starts Freelens on the
Extensions page and asks you to confirm the installation:

[freelens://app/extensions/install/@thcraft/freelens-pod-file-browser](freelens://app/extensions/install/@thcraft/freelens-pod-file-browser)

Freelens downloads the package from the npm registry and checks it against the integrity the registry gives. To update,
do the same, or click the notification the extension shows when a new version is out: Freelens replaces the installed
version after you confirm it.

### From a tarball

The package on npm is a tarball you can download as well (`npm pack @thcraft/freelens-pod-file-browser`); enter the
path to it, or drop it on the Freelens window.

### From the source

Build it (see [Development](#development)) and enter the path of the checkout, the folder with `package.json`.
Freelens then runs the extension from that folder and lists it as unverified.

## Getting started

1. Open a cluster in Freelens.
2. Open the files of a pod in one of three ways:
   - **Workloads → Pods**, open the menu of a pod (`⋮`) and choose **Browse files**;
   - click a pod and, in its details, press **Browse files** in the "Files" section;
   - open **Pod Files** in the cluster sidebar and pick the namespace, the pod and the container.
3. The browser starts in the working directory of the container. Click folders and path segments to move around,
   double-click a file to view or edit it, select items with the checkboxes for **Download**, **Permissions** and
   **Delete**, and drop files from your desktop on the listing to upload them.

Opening the pod details runs nothing in the container; the "Files" section starts only when you press **Browse files**.

## How it works

The renderer part of the extension draws the browser; it has no access to Node. It asks the main process of the
extension, over the Freelens IPC of the extension, to do the work. The main process runs the kubectl Freelens itself
uses, with the environment of the cluster connection (`Main.Shell` of the extension API), so authentication, proxies
and the kubectl version are the same as in the Freelens terminal.

- Paths are passed to the scripts as positional parameters, never inserted into the script text.
- Uploads and saves write into a temporary file next to the target and replace the content of the target only when the
  announced number of bytes arrived. Writing into the target, rather than renaming over it, keeps its owner, mode and
  hard links. If the connection breaks off hard, a hidden `.pod-file-browser.XXXXXX` file may be left next to the
  target.
- Files download in chunks of 8 MiB (with `dd` in the container), each in a `kubectl exec` of its own, checked for its
  length and read again when it breaks off; without `dd` a file comes in one stream. Downloads write a `.part` file next
  to the chosen file and rename it once complete.
- kubectl 1.30 and newer run `kubectl exec` over WebSockets, which some proxies in front of the API server cut during a
  large transfer. When that happens, the transfer is repeated over SPDY (`KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false`), and
  the cluster keeps using SPDY until Freelens restarts.
- The listing, reading and other quick operations give up after 60 seconds; deleting, recursive changes and transfers
  take as long as they need.

The update check asks the npm registry for the newest version of the package
(`https://registry.npmjs.org/@thcraft%2Ffreelens-pod-file-browser/latest`) a minute after Freelens starts and then once
a day, through the proxy settings of Freelens. It sends nothing else, and turned off it reads nothing.

Known limitations: file names containing a newline are not listed correctly, and the editor normalises mixed line
endings (CRLF and LF) to the prevailing one when you save.

## Development

Built with TypeScript, React and MobX on the
[Freelens extension API v2](https://github.com/freelensapp/freelens/tree/v2.0.0/docs/extensions), from the
[freelens-example-extension](https://github.com/freelensapp/freelens-example-extension) template, whose build, type
check and lint setup it keeps. [AGENTS.md](AGENTS.md) describes the code and the rules for working on it.

| Folder         | Contents                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/common`   | Types and validation shared by both processes (`protocol.ts`)                                                                                                           |
| `src/main`     | Main process: IPC handlers and dialogs (`index.ts`), kubectl runner (`kubectl.ts`), container scripts and file operations (`pod-fs.ts`), text encodings (`encoding.ts`) |
| `src/renderer` | Renderer: registrations (`index.tsx`), the browser and its dialogs (`components/`), the Pod Files page, the pod details section and the pod menu item                   |

Node.js 24 (`.nvmrc`) and pnpm (through corepack):

```sh
corepack enable
pnpm install
pnpm build          # dist/main.js, dist/renderer.js, dist/renderer.css
pnpm dev            # rebuilds on every change; Freelens reloads the extension
pnpm type:check
pnpm test:unit
pnpm lint:check
pnpm knip:check
```

For the development loop, install the checkout from its folder once (see [From the source](#from-the-source)) and run
`pnpm dev`. A change to `main` or `renderer` in `package.json` needs Freelens restarted.

The unit tests run the container scripts in the local POSIX shell where there is one (Git Bash on Windows), so they
cover the scripts themselves, not only their callers.

**CI.** The workflows in `.github/workflows` type-check, test, build, lint and run Knip on every push and pull request.
`release.yaml` runs on a `v*` tag: it checks that the tag matches `package.json`, builds and tests the extension,
stages it on npm with trusted publishing (no npm token in the repository; versions with a suffix go to the `next`
dist-tag, others to `latest`), and creates the GitHub release (0.x and versions with a suffix as pre-releases) with
the tarball, its `.tgz.sha256` and the notes from `CHANGELOG.md`. Running it by hand builds the tarball as an artifact
without releasing anything.

To release, add a `## <version> (<date>)` section to `CHANGELOG.md`, set the version in `package.json`, commit, and tag:

```sh
git tag -a v0.4.1 -m "Pod File Browser 0.4.1"
git push origin main v0.4.1
```

The workflow only stages the version on npm. It becomes public once a maintainer approves it on npmjs.com
(**Staged Packages**, with 2FA), or with `npm stage approve <stage-id>`.

Push one tag at a time: GitHub starts no workflow for a push of more than three tags.

## License

[MIT](LICENSE) © 2026 thcraft. The build, type check and lint setup comes from
[freelens-example-extension](https://github.com/freelensapp/freelens-example-extension), MIT © 2025-2026 Freelens
Authors. The bundled [iconv-lite](https://github.com/pillarjs/iconv-lite) is MIT licensed.
