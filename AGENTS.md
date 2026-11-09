# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

This repository is Pod File Browser, a Freelens extension that browses the
filesystem of the containers of a pod: listing, download, upload, editing
text files in any encoding, chmod, chown, rename and delete. It started as a
copy of
[freelensapp/freelens-example-extension](https://github.com/freelensapp/freelens-example-extension),
the reference template for Freelens extensions. The build, type-check, lint
and CI patterns in this file come from that template, each with its reason,
and are kept as they are; "Architecture" and "Design" describe this
extension.

- **Language**: TypeScript 7.x
- **Runtime**: Freelens >= 2.0.0 (extension API v2)
- **Toolchain**: Node.js 24.x, yq 4.x and cosign 3.x (`mise.toml` with
  `mise.lock`; Node also in `.nvmrc`)
- **Package manager**: pnpm 12.x (`packageManager`, run through corepack)
- **License**: MIT

Library and tool versions follow the Freelens stack exactly: the catalog in
Freelens's `pnpm-workspace.yaml` for libraries, the root `package.json` scripts
of Freelens for tools run with `pnpm dlx` (Biome, knip, Trunk launcher), and
Freelens's `mise.toml` and `.nvmrc` for Node and the other mise tools.
Renovate keeps them there: custom datasources in `.renovaterc.json` read the
versions from the same Freelens files on `main`, so an update arrives only once
Freelens has adopted it, at that version, in one `Freelens dependencies` group
PR together with a release of `@freelensapp/extensions`. A dependency added to
`package.json` follows the Freelens catalog unless the catalog rule excludes
it; one that Freelens does not have must be excluded there, or its lookup fails
on the Dependency Dashboard. The catalog rule matches only `dependencies` and
`devDependencies`, so an override copied from Freelens's `pnpm-workspace.yaml`,
such as `@kubernetes/client-node>@types/node`, is otherwise looked up on npm
and runs ahead of Freelens. Such an override gets a rule of its own, next to
the catalog rule: `matchManagers: ["npm"]`, the override's key in
`matchDepNames`, `overrideDatasource: "custom.freelens-catalog"`, the overridden
package in `overridePackageName`, and the catalog rule's `rangeStrategy`,
`minimumReleaseAge` and `groupName`
(freelensapp/freelens-for-claude-extension@f2f49241828f201890423e070655c2dc04120b23).
The overrides of this repository are security fixes of the development tools
(`pnpm-workspace.yaml`), not copied from Freelens; Renovate looks them up on
npm. What Freelens does not define (GitHub Actions, the
tool versions in the workflows, `shx`) Renovate updates as usual.
pnpm is the exception: Renovate updates it from the npm registry, in a pull
request of its own, and not to the version of Freelens's `packageManager`.
`packageManager` carries a Corepack hash (`+sha512.…`), and Renovate updates
the hash only from the digest of the new version, which the registry has and a
custom datasource does not; without it the update fails with "no valid digest
available".
`mise.lock` pins a checksum and a URL per tool for all eight platforms; after
changing `mise.toml`, run `mise lock` (not only `mise install`, which re-locks
just the current platform). `mise.lock` is lockfile revision 3
(`lockfile_version = 3`), which needs mise 2026.9.16 or newer; older versions
reject it. `@freelensapp/extensions` is
pinned to one exact version. The libraries the host provides at runtime
(`react`, `react-dom`, `mobx`, `mobx-react`) and their types are
devDependencies only, for compiling and testing; `electron` is a devDependency
for its types only.

pnpm settings live in `pnpm-workspace.yaml`. A dependency runs its install
scripts only when `allowBuilds` sets it to `true`; a new dependency with
install scripts that is not listed there fails `pnpm install`, so add it with
`true` or `false` deliberately. pnpm refuses versions younger than its
`minimumReleaseAge` (1 day), with `@freelensapp/extensions` excluded because
a Freelens release is adopted on the day it is published, together with the
stack it was built with. An exact version that Freelens lets in early for a
security fix, such as `electron@44.10.0`, is excluded here too, with the same
comment, so that the update installs; the entry goes once the version is
older than the policy.

`strictPeerDependencies: true` makes `pnpm install` fail when the extension's
own copy of a shared library is outside the peer range that
`@freelensapp/extensions` declares for it: `react`, `react-dom`,
`@types/react`, `@types/react-dom`, `mobx`, `mobx-react`, `monaco-editor` and
`electron`. These peers are optional, so they are checked only when the
extension declares the library, which it does for every one it imports or
compiles against. Without the setting pnpm reports a mismatch as one warning
line and installs anyway. Freelens does not set it, because its own tree takes
these libraries from its catalog, which defines the ranges; an extension
declares its own copies, and these peers are the only place where they are
compared with the versions the host runs. The types are peers as well, so the
package's declaration compiles against the extension's own `@types/react` and
`@types/react-dom`, one copy of each, and the package does not install them for
it. An extension with renderer code declares both: the declaration imports its
React types from `react` and `react-dom`, and the renderer's JSX and component
props are checked against them. A main-only extension needs neither; its code
reaches no React type, and `skipLibCheck` leaves the declaration's own imports
unchecked.

An extension that renders `Renderer.Component.MonacoEditor` compiles against
`monaco-editor` without importing it, so it declares `monaco-editor` in
`devDependencies` at the host's version as well. `MonacoEditorProps` takes its
`options` and callback types from that package; without it they are `any`, and
`skipLibCheck` hides the unresolved import. This extension renders the editor
and declares it ("The host-provided libraries, and how to mark them
external" in Freelens's `migrating-from-v1.md`, and contracts C3 and C11 of
`api.md`).

The one runtime dependency, `iconv-lite`, is bundled into main and declared in
`dependencies`. Freelens does not have it, so `.renovaterc.json` excludes it
from the catalog rule (`"!iconv-lite"`) and Renovate updates it from npm.

## Common Commands

```bash
# Type checking
pnpm type:check                # All of the programs below, in this order
pnpm type:check:sources        # main and renderer, each with src/common/
pnpm type:check:tests          # Tests and test support
pnpm type:check:tooling        # Vite and Vitest configs, build plugins
pnpm type:check:environments   # Environment tests

# Linting & formatting
pnpm biome:check          # TypeScript/TSX, JS, JSON, CSS, SCSS, HTML, YAML, Markdown (biome)
pnpm biome:fix            # Auto-fix the formats above
pnpm trunk:check          # TOML, shell, workflows, yamllint, and Biome again (changed files)
pnpm trunk:fix            # Auto-fix TOML, shell, and the Biome formats
pnpm lint:check           # Alias for biome:check
pnpm lint:fix             # Alias for biome:fix
pnpm knip:check           # Unused files, unused and unlisted dependencies (knip)

# Tests
pnpm test:unit            # vitest

# Build
pnpm build                # Both Vite runs, without the type check
pnpm dev                  # Both Vite runs in watch mode, for a directory install

# Pack for testing
pnpm pack:dev             # Bump prerelease version, build, and create .tgz for install in Freelens app

# Clean
pnpm clean                # Clean dist/
pnpm clean:dts            # Remove generated *.d.scss.ts files
pnpm clean:all            # Clean everything (dist, dts, node_modules, tgz)
```

## Architecture

```text
src/
  common/protocol.ts              # IPC channels, shared types, path helpers, mode/owner validation, text encodings
  common/settings-store.ts        # The extension's settings (ExtensionStore), loaded and synced by both processes
  common/updates.ts               # Package name, npm registry and install URLs, version comparison
  main/index.ts                   # Main entry (Main.LensExtension): IPC handlers, open/save dialogs, picked files
  main/kubectl.ts                 # Runs the host's kubectl with the cluster's environment; exec and sh -c arguments
  main/pod-fs.ts                  # The container scripts (POSIX sh) and the file operations built on them
  main/encoding.ts                # Default encoding, binary detection, decoding and encoding with iconv-lite
  main/local-names.ts             # Local file names for downloads that Windows accepts
  main/update-check.ts            # Daily check of the npm registry and the system notification of a new version
  renderer/index.tsx              # Renderer entry (Renderer.LensExtension): every registration
  renderer/ipc.ts                 # Renderer.Ipc client: one typed function per channel
  renderer/pages/                 # The "Pod Files" cluster page: namespace, pod and container in the URL
  renderer/details/               # The "Files" section of the pod details
  renderer/menus/                 # "Browse files" in the pod menu, which opens the page
  renderer/components/            # FileBrowser and its dialogs, PathBar, ErrorBoundary and ErrorPage
  renderer/pod-containers.ts      # Containers of a host Pod object, the default container, labels
  renderer/format.ts              # Sizes, times, sorting, permissions to octal, editor language
  renderer/icons/                 # The sidebar icon
  renderer/preferences/           # The update setting and status in Preferences > Extensions
test/freelens-extensions.ts       # Runtime stub of @freelensapp/extensions for Vitest
environment-tests/               # Probes for the per-environment programs
build/                           # Vite plugins: host modules, standard decorators, CSS module declarations
```

Build output goes to `dist/`: `main.js`, `renderer.js` and `renderer.css`, with
source maps. `main` and `renderer` in `package.json` point at the two entries.

## Design

### Two processes

The renderer has no Node and no Electron ("Rules That Fail Silently"), so
everything that runs a process, touches a local file or shows a native dialog
is in main, behind `Renderer.Ipc` / `Main.Ipc`. Every channel is named in
`IpcChannel` of `src/common/protocol.ts`, with one function per channel in
`src/renderer/ipc.ts`. Every main handler answers with an `IpcResult`, so the
renderer gets the message as it was thrown rather than wrapped by Electron.

Main does not trust the renderer for local files: `upload-files` takes only
paths that the open dialog of main returned (`pickedFiles` in
`src/main/index.ts`), and downloads go only where the save or folder dialog of
main says.

### Running commands in a container

`runKubectl` in `src/main/kubectl.ts` runs the kubectl and the environment
that `Main.Shell.getKubectlPath(clusterId)` and `getEnvironment(clusterId)`
return (contract C15 of `api.md`), so authentication, proxies and the kubectl
version are those of the Freelens terminal. Both are cached per cluster for a
minute, and only while the kubeconfig the environment names exists: a
disconnect removes it. Never build a kubeconfig or a kubectl path of your own.

Every operation is a POSIX `sh` script in `src/main/pod-fs.ts`, run as
`kubectl exec … -- sh -c <script> sh <args>`:

- **Paths are positional parameters** (`"$1"`, `"$@"`), never part of the
  script text. Paths from the renderer are absolute, so none can be taken for
  an option; values that are not paths (mode, owner) are validated in both
  processes (`isValidMode`, `isValidOwner`) and may not start with `-`.
- **BusyBox compatible.** Only POSIX sh and the options BusyBox has: `stat -c`,
  `head -c`, `mktemp`, `readlink`, `tar cf`, `set -C`. A script must work when
  an optional tool is missing where the README says so (`stat`, `mktemp`).
- **The listing protocol** is line based with `/` as the field separator,
  which no file name contains (`parseListing`); names with a newline are a
  known limitation.
- **Writes are staged.** `WRITE_SCRIPT` receives the expected byte count,
  writes stdin to a `mktemp` file next to the target and copies it into the
  target only when the count matches, so a transfer that breaks off leaves the
  target as it was. It writes into the target rather than renaming over it, to
  keep owner, mode and hard links.
- **Downloads are staged locally** in a `.part` file that is renamed over the
  chosen file only when complete. A file downloads in chunks of `CHUNK_SIZE`
  (8 MiB) read with `dd` (`CHUNK_SCRIPT`), one `kubectl exec` each, checked for
  its length and read up to `CHUNK_ATTEMPTS` times; main broadcasts the progress
  (`transfer-progress`) after every chunk. A folder is one `tar` stream.
- **WebSockets or SPDY.** kubectl 1.30 and newer run exec over WebSockets, and
  some proxies in front of the API server cut a WebSocket during a large
  transfer ("error reading from error stream: read message"). `transfer()`
  repeats such a transfer once with `KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false`
  (SPDY), and a cluster where that works keeps SPDY (`preferSpdy`). Only what is
  safe to repeat goes through `transfer()`: reads, chunks, archives and the
  staged writes; rename, create and delete do not.
- **Timeouts.** Quick operations (`exec` with its default) give up after 60 s;
  delete, recursive chmod/chown and transfers pass no timeout.

The unit tests run the scripts in the local POSIX shell
(`src/main/pod-fs-scripts.test.ts`, Git Bash on Windows); add a test there for
every new script or behaviour of one. Tests that need mode bits or symlinks are
skipped on Windows.

### Text and encodings

`readFile` reads the first 8 KiB (`SNIFF_SIZE`) and the size. NUL bytes
outside UTF-16 make a file binary: it is not read further unless the user
picks an encoding, and it is never editable, because Monaco may change line
endings. Text is read up to `MAX_EDITABLE_FILE_SIZE` plus one byte, to tell a
file that grew from one that fits. Files open as UTF-8, or UTF-16 by its byte
order mark; nothing else is guessed. A file is editable only when its content
encodes back to exactly the bytes read (`lossless`), and `encodeText` refuses
characters the encoding cannot hold instead of letting iconv-lite write `?`.
`iconv-lite` is the one bundled runtime dependency.

### New version notifications

`UpdateChecker` (`src/main/update-check.ts`) runs in main, which exists
once; the renderer runs in the root frame and in every cluster frame and would
notify once per frame. It reads the registry document of the `latest`
dist-tag (`LATEST_URL`) with `Main.Util.fetch`, which applies the user's
proxy settings (contract C12 of `api.md`), a minute after activation and then
every 24 hours, and shows an Electron `Notification` once per version
(`notifiedVersion`). Clicking it, or "Install" in the preference, opens
`INSTALL_URL` (`freelens://app/extensions/install/<package>`): Freelens asks
the user to confirm and replaces the installed version. The setting
`checkForUpdates` lives in `SettingsStore`, an `ExtensionStore` both
processes load: the host keeps one file and syncs the two copies, so the
checkbox in the renderer turns the check in main off and on. The preference
shows the status that main reports over IPC (`update-status`,
`check-for-updates`, `install-update`).

### Renderer

- `FileBrowser` (`src/renderer/components/file-browser.tsx`) is the one
  browser: the page and the pod details only choose the target and the path
  around it and pass `compact` for the details. New browser features go into
  `FileBrowser` or its dialogs, never into one of the two hosts.
- **A listing belongs to its target and path** (`listingKey`). While another
  one loads, the old one is not shown and no action can start, so that no
  action runs with names of one container against another.
- **One action at a time.** `run()` refuses a second action (`busyRef`), and
  every way to start one, toolbar, row icons, drag and drop, is disabled while
  `ready` is false.
- The page keeps namespace, pod, container and path in `PageParam`s. The
  host's `Select` calls `onChange` inside a mobx action, where several
  `PageParam.set()` calls each start from the old URL; change several params
  with `setRaw`/`clear` in one `runInAction` (`updateParams`).
- The page takes its pods from the host's `Renderer.K8sApi.podsStore`, loaded
  with `loadAll({ namespaces: [ns], merge: true })`, which replaces the pods of
  that namespace only. Read the store inside a component: the renderer entry
  loads in the root frame too, which has no cluster and no pod store.
- The pod details section runs nothing in the container until the user
  presses "Browse files".

## Renderer Components

- Pages and details panels are `observer` components from `mobx-react`, which the build maps to the host's copy.
- Every page, details panel and menu item renders inside an `ErrorBoundary` from
  `src/renderer/components/error-boundary.tsx`. It logs what its children throw with `extension.name` and the
  component stack, and renders `ErrorPage` in place of a page or a details panel, and nothing in place of a menu item.
  `clusterPages`, `kubeObjectDetailItems` and `kubeObjectMenuItems` are mapped through `withPageErrorBoundary`,
  `withDetailsErrorBoundary` and `withMenuItemErrorBoundary`, each annotated with its type from
  `Renderer.LensExtension`, so an entry added to a field is wrapped as well. A `try`/`catch` around the call of a
  component is not enough: a child throws when React renders it, after the call.
- The pod details section and the pod menu item are registered with `Renderer.K8sApi.detailsFor` and
  `Renderer.K8sApi.menuItemFor` and the host's `Renderer.K8sApi.Pod`, so their props are typed with the pod. The
  objects the host passes are its own `Pod` instances.
- Components import their CSS module for the class names only, with no `?inline` import and no `<style>` tag; the
  rules reach the page through `renderer.css`. SCSS variables are in `src/renderer/vars.scss`, used with
  `@use "../vars"`. The `*.module.d.scss.ts` declarations are written by the renderer build and committed; run
  `pnpm build` after changing a stylesheet.
- The host renders a cluster page with `params` only, and a details panel or a menu item with `object` (and
  `toolbar`); anything else, such as the extension, comes from the registration
  (`(props) => <PodFilesDetails {...props} extension={this} />`).
- Use the host's components (`Renderer.Component`: `Button`, `Input`, `Select`, `NamespaceSelect`, `Dialog`,
  `ConfirmDialog`, `Notifications`, `MonacoEditor`, `Icon`) and its CSS variables (`--textColorPrimary`,
  `--borderFaintColor`, ...), so the extension follows the theme.

## Rules That Fail Silently

Each of these compiles when it is broken, and breaks the extension at runtime
or not visibly at all. The sections named in parentheses explain the
mechanism; this is the list to check a change against.

- **The host's React and mobx, one copy each.** Import `react`, `react-dom`,
  `mobx` and `mobx-react` by their bare module ids. A second React throws
  `invalid hook call`; a second mobx throws nothing, and the host never reacts
  to its observables. The build fails on the ways a second copy gets in
  ("Modules provided by the host").
- **Standard decorators.** An observable field is `@observable accessor`, and
  the class does not call `makeObservable(this)`. Without `accessor` the
  production build of mobx leaves the field unobservable; a unit test that
  imports the class fails ("Decorators").
- **No Node or Electron in renderer and common code.** They are `undefined` in
  the renderer. The build fails on an import, `pnpm type:check` on a global
  ("Process-specific settings").
- **One CSS asset, `dist/renderer.css`.** Any other name, or a second asset,
  leaves the extension unstyled. Nothing checks it; look at `dist/` after a
  change to the CSS setup ("CSS").
- **One tsconfig per environment.** Each program has only its runtime's `lib`
  and `types`, and no declaration may load Node into the renderer or the DOM
  into main; otherwise a wrong API type-checks and is `undefined` at runtime.
  The environment tests fail on a leak ("TypeScript").
- **No instance method on a KubeObject subclass.** The objects from the host
  do not have it, and the call throws. Nothing checks it
  ("CRD KubeObject Pattern").
- **A component that chooses the version through `getStore()` is an
  `observer`.** The host registers a CRD's APIs after the cluster frame has
  loaded the CRDs; a component that is not an `observer` and rendered before
  then shows the kind as not installed until the user navigates away and back.
  Only a test whose `getStore` reads an observable shows it
  ("CRD KubeObject Pattern").
- **`this.props` of an `@observer` class component only in its `render()`.**
  Under mobx-react 10 they are not observable. A `@computed` getter that reads
  them, or a method the host calls from its own derivations (`getItems` and
  `customizeHeader` of `KubeObjectListLayout`), throws
  `[mobx-react] Cannot read "X.props" in a reactive context` when the page
  renders, and the host shows its "App crash" page. The type check, the build
  and unit tests in a Node environment pass. Read the values in `render()` and
  hand them to the callback, or make the component a function component
  ("MobX 7 and mobx-react 10 (standard decorators only)" in Freelens's
  `migrating-from-v1.md`).
- **A memo over a store's items is keyed on something that changes with
  them.** The host keeps one observable array per store and updates it in
  place, with `replace` and `splice`, so `store.items` stays the same array
  while the objects in it change. A `useMemo` keyed on it, or on a prop that
  holds it, is computed once, and an open view keeps the objects it was opened
  with. An `observer` that reads the items while it renders follows them; a
  memo needs a key such as the ids and `resourceVersion`s of the objects. It
  shows only on a cluster whose objects change while the view is open.
- **An effect creates what its cleanup aborts or releases.** Freelens dev
  renders in `React.StrictMode`, which runs an effect, cleans it up and runs
  it again on the same instance. An `AbortController` kept in a `useRef` is
  aborted by the first cleanup, and every request of the second run with it;
  the host takes an aborted `loadAll` for no failure, so the view shows
  nothing and logs nothing. Create the controller, and the list of watches to
  release, inside the effect. The production build has no `StrictMode`, so
  only Freelens dev shows it, and only in a view that loads stores no other
  page has loaded before it.
- **Every page, details panel and menu item inside an error boundary.** A
  `try`/`catch` around the call of a component catches only what the call
  throws, not what a child throws when React renders it or what a callback of
  `KubeObjectListLayout` throws from the host's render. Such an error replaces
  the main area with the host's error, or, from a details panel or a menu item,
  the whole cluster view with the host's crash page. Map `clusterPages`,
  `kubeObjectDetailItems` and `kubeObjectMenuItems` through their wrappers in
  `error-boundary.tsx` ("Renderer Components").
- **A cluster page gets the extension from its registration.** The host passes
  `params` only. The type check rejects a page that requires another prop, but
  not one that declares it optional ("Renderer Components").
- **An ESM `main`, and the entries in `package.json` unchanged while
  `pnpm dev` runs.** The host refuses to reload a CommonJS main and logs why,
  and it watches only the entries it started with, so a manifest change needs
  Freelens restarted.
- **A bundled CommonJS package loads in the ESM main.** Main is built for
  Rolldown's `node` platform, which gives it a `require`, and defines
  `__dirname` and `__filename`. Without either, the package throws when
  Freelens evaluates `dist/main.js`, and the extension does not activate;
  `pnpm build` and `pnpm type:check` pass ("Process-specific settings").

Neither `pnpm build` nor `pnpm dev` runs the type check, so a Node global in
renderer code passes them; `pnpm type:check` and `type-check.yaml` catch it.

## Build

`vite.config.mjs` builds one entry point per run, in library mode, as ESM:
`vite build` builds the renderer and empties `dist/`, and `vite build --mode
main` builds main next to it. The two runs share no chunk; each bundle carries
its own copy of the `src/common/` code it imports. Nothing is minified.

`pnpm dev` runs the same two builds in watch mode, side by side, for a
directory install: the host reloads the extension when either entry is
rewritten. Its renderer run passes `--no-emptyOutDir`. In watch mode Vite
empties the output directory again before every rebuild, so a renderer rebuild
would delete `dist/main.js`, and the host would have no main entry to reload.

### Modules provided by the host

The host publishes its singletons on `globalThis.FreelensExtensionApi`, and
each process publishes only the ones it has. This is contract C3 of the
Freelens extension API (`docs/extensions/api.md`):

| Module id           | Global            | Published in |
| ------------------- | ----------------- | ------------ |
| `react`             | `React`           | renderer     |
| `react-dom`         | `ReactDom`        | renderer     |
| `react/jsx-runtime` | `ReactJsxRuntime` | renderer     |
| `mobx`              | `Mobx`            | both         |
| `mobx-react`        | `MobxReact`       | renderer     |
| `monaco-editor`     | `MonacoEditor`    | renderer     |

`build/vite-plugin-host-modules.mjs` replaces a bare import of one of these
with a module that reads the global, in the extension's code and in every
library it bundles. Its named exports are the members of the copy installed as
a devDependency, which is pinned to the host's version, so an import of a name
the host's version lacks fails the build. The plugin also fails the build on an
import of a host module that the process does not publish (`react` in main),
and on a subpath of a host package that the host does not publish
(`react-dom/client`, `react/jsx-dev-runtime`). Both would otherwise either read
`undefined` at runtime or bundle a second copy. A second React throws
`invalid hook call`; a second mobx throws nothing, and the host simply never
reacts to its observables.

Everything else is bundled. That includes `@freelensapp/extensions`, a shim of
three lines that reads `Common`, `Main` and `Renderer` off the same global; it
must not be mapped. The host installs no dependencies of an extension, so
whatever the code needs at runtime and the host does not provide has to be in
the bundle.

### Process-specific settings

- **Renderer**: nothing is external. Renderer code gets no Node or Electron, and
  an import of a Node builtin or of `electron` fails the build (Vite would
  otherwise replace it with an empty module and only warn).
  `process.env.NODE_ENV` is replaced at build time, because library mode
  leaves it for a consumer's bundler and the page has no `process`.
- **Main**: Node builtins (`node:*` and bare) and `electron` stay external.
  Bundled packages resolve with Vite's server conditions, so main gets their
  Node builds rather than their browser builds. Main is built for Rolldown's
  `node` platform (`build.rolldownOptions.platform`), the renderer for
  `browser`, the default of a Vite client build. A bundled CommonJS package
  `require()`s the builtins, and an ES module has no `require`: for the
  `browser` platform Rolldown turns the call into a `__require` shim that
  throws ``Calling `require` for "node:assert" in an environment that doesn't
  expose the `require` function`` as soon as the bundle is evaluated, and for
  `node` it defines `__require` with `createRequire(import.meta.url)`.
  `__dirname` and `__filename` are the other half: Node passes them to a
  CommonJS module, Rolldown leaves them as they are on either platform, and
  the ES module throws `ReferenceError: __dirname is not defined in ES module
  scope`. Main defines them (`define`) as `import.meta.dirname` and
  `import.meta.filename`, the directory and file of `dist/main.js`, not of the
  package: a library that loads a file next to itself, such as a `.wasm`,
  finds it only when the build puts it in `dist/`.
  `pnpm build` and `pnpm type:check` pass either way, and nothing before
  Freelens evaluates `dist/main.js`, so on the wrong platform the extension
  fails only when Freelens loads it. A main bundle without CommonJS is the
  same on both platforms, byte for byte.

### Decorators

MobX 7 supports standard decorators only, and Oxc, which transpiles TypeScript
for Vite, passes them through unlowered, while neither Node nor Chromium runs
them yet. `build/vite-plugin-standard-decorators.mjs`, copied from Freelens,
hands every module with a decorator to esbuild first, which lowers the
decorators and their `accessor` fields. Both `vite.config.mjs` and
`vitest.config.ts` use it. A decorator that reaches the host or a test
unlowered is a syntax error when the module is evaluated.

An observable field is an `accessor` (`@observable accessor enabled = false;`),
and the class does not call `makeObservable(this)`. `@observable` on a plain
field type-checks and builds; the development build of mobx throws when the
class is defined, and the production build leaves the field unobservable.

### CSS

The host links the stylesheet named after the renderer entry, `renderer.css`
next to `renderer.js`. Library mode extracts the CSS of the whole bundle into
that one file (`build.lib.cssFileName`). A build that emits more than one CSS
asset, or a differently named one, leaves the extension unstyled. A component
imports its CSS module for the class names only and renders no `<style>` tag;
the rules reach the page through `renderer.css`. CSS modules
use `camelCaseOnly` class names.

### CSS module declarations

`build/vite-plugin-css-module-declarations.mjs` writes `x.module.d.scss.ts`
next to every `x.module.scss` the renderer build imports, in `vite build` and
in watch mode. It takes the class names from Vite's own `preprocessCSS`, with
the build's resolved config, so they are the names the bundle exports, after
`localsConvention`; a class inside `:global(...)` is not one of them.

The plugin is written so that a build cannot leave a committed declaration
empty or partial, whether it fails, is interrupted or is killed:

- it awaits its work in `transform`, so the build does not end while a write is
  pending;
- it writes a declaration only when the content changed, so a build that
  changes no stylesheet touches no file;
- it writes to a temporary `*.tmp` file next to the declaration and renames it
  over the declaration, which replaces it whole or not at all.

The plugin has no options and no dependency other than Vite, and it refers to
no path of this repository, so other extensions copy it unchanged.

## TypeScript

Main code runs in Node, renderer code in a browser page, and common code in
both. Each is type-checked in a program of its own, so that an API the runtime
does not have fails `pnpm type:check` rather than the extension:

| Config                       | lib                       | types                 | Files                                                              |
| ---------------------------- | ------------------------- | --------------------- | ------------------------------------------------------------------ |
| `src/main/tsconfig.json`     | ES2024                    | `node`                | `src/main/`, `src/common/`                                         |
| `src/renderer/tsconfig.json` | ES2024, DOM, DOM.Iterable | `vite/client`         | `src/renderer/`, `src/common/`                                     |
| `src/common/tsconfig.json`   | ES2024, WebWorker         | none                  | `src/common/`                                                      |
| `src/tsconfig.json`          | ES2024, DOM, DOM.Iterable | `node`, `vite/client` | `*.test.ts(x)` under `src/`, and `test/`                           |
| `tsconfig.json`              | ES2024                    | `node`                | `vite.config.mjs`, the Vitest configs, `svgo.config.mjs`, `build/` |

All of them extend `tsconfig.base.json`, which has the compiler options of
Freelens's fixture extension: `strict`, `moduleResolution: Bundler`,
`useDefineForClassFields`, `noUncheckedSideEffectImports` and `skipLibCheck`
among them. `skipLibCheck` is required: `extension-api.d.ts` is one declaration
for both processes and names DOM types and the `Electron` namespace, which no
single program has. Write `types` in every config; it decides which `@types`
packages a program sees.

### Main, renderer and common

The main and renderer configs both include `src/common/`. Compiled as main,
common code fails on the DOM; compiled as renderer, it fails on Node. What
passes both is valid in both, and that is the check that decides. Common code
uses only what both runtimes have: `globalThis.crypto`, `TextEncoder` and
`TextDecoder`, `URL` and `URLSearchParams`, `AbortController`,
`structuredClone`, and the timers, with the timer handle kept opaque.

`src/common/tsconfig.json` is for the editor, which gives a file to one config
only. Its `WebWorker` lib is the closest single match and an approximation:
`self` and `postMessage` compile there and fail in the main program.

The common program is not compiled on its own. `environment-tests/tsconfig.json`
extends `src/common/tsconfig.json` and keeps its `include`, so
`tsc -p environment-tests`, in `pnpm type:check:environments`, compiles
`src/common/` with the common settings, together with the probes. A program of
`src/common/` alone has no input when the directory has no source file, and
`tsc` stops on that (TS18003); the environment tests always have their probes,
so `pnpm type:check` passes with an empty `src/common/`. Keep
`src/common/tsconfig.json` even then: the editor uses it, and the environment
tests extend it.

The split does not cover the API namespaces: `Main` and `Renderer` compile in
every program, and the one the process does not have is `undefined` at runtime.
Common code uses `Common`.

### Asset imports

The renderer program has `vite/client`, which declares `*?raw`, `*?inline` and
the CSS modules and brings no Node into the program. With
`allowArbitraryExtensions`, `import styles from "./x.module.scss"` resolves to
the generated `x.module.d.scss.ts`, so a class name that the stylesheet lacks
fails the check. Without that file, after `pnpm clean:dts`, the import falls
back to the untyped declaration of `vite/client`.

### Environment tests

`types` and `lib` alone do not keep an environment pure. A declaration file
with `/// <reference types="node" />` loads all of `@types/node` into any
program that reaches it, whatever `types` says, and one with
`/// <reference lib="dom" />` loads the DOM. `environment-tests/` proves the
split holds:

| File             | Compiled with          | Must                      |
| ---------------- | ---------------------- | ------------------------- |
| `node-apis.ts`   | renderer, common       | fail on every marked line |
| `dom-apis.ts`    | main, common           | fail on every marked line |
| `worker-apis.ts` | main                   | fail on every marked line |
| `shared-apis.ts` | main, renderer, common | pass                      |

Each line that must fail carries `// @ts-expect-error`, so a program that
starts accepting it fails with an unused directive. The configs there extend
the source configs and keep their `include`, so the probes are compiled
together with the sources and every declaration the sources reach. Compiled
alone, they would not see a declaration that a dependency of the sources brings
in.

When a declaration leaks, the environment tests fail; keep the leak out rather
than relax a probe. For Node
in the renderer, point `typeRoots` of the renderer config at a directory with
an empty `node` package, which a reference directive resolves to first. For
the DOM in main, remove the directive from the declaration with `pnpm patch`.

### Tests and tooling

Tests are not in the environment programs. Vitest runs them in Node, with
jsdom for files that ask for it, so `src/tsconfig.json` gives them the DOM and
Node. It sits in `src/` so that an editor finds it for a test file: the
environment config next to the test excludes it, and the editor goes on to the
next `tsconfig.json` up the tree. Tests compile against the real
`@freelensapp/extensions` declaration, while Vitest replaces the package with
`test/freelens-extensions.ts` at runtime.

No config declares the Vitest globals. TypeScript has no per-file globals, so
declaring `describe` or `vi` for tests would declare them for every file in the
program. Test and test-support files import what they use:

```ts
import { describe, expect, it, vi } from "vitest";
```

The module resolves from every program, so Biome keeps it out of the
extension's code: `style/noRestrictedImports` rejects an import of `vitest`
outside `src/**/*.test.*`, `test/` and `integration/`. The same rule rejects
there the testing helpers of React: the `act` named import of `react`,
`react-dom/test-utils` and `@testing-library/*`. They type-check, build and
pass the unit tests, which run the development build of React, but `act`
delegates to `React.act`, which the production build that Freelens runs leaves
out, so the call throws only in the host. `globals: true` stays on in
`vitest.config.ts` at runtime only, because React Testing Library registers its
automatic cleanup only when `afterEach` is a global.

`@freelensapp/extensions` is stubbed because the real package cannot run in a
test: it is a shim that reads `Common`, `Main` and `Renderer` off
`globalThis.FreelensExtensionApi`, which only the host sets, and it ships no
mocks. The `alias` in `vitest.config.ts` points the import at
`test/freelens-extensions.ts`, for the tests and for the extension code they
import. The stub covers only what the tests use, at runtime only; the type
check still uses the real declaration. So a test that reaches a member the stub
lacks compiles and fails on `undefined`: add the member to the stub, as small as
the test needs. The other host modules are not stubbed: `react`, `mobx` and
`mobx-react` resolve to the devDependencies, the host's versions.

Vitest runs the development build of mobx, so a test that imports
a class with `@observable` on a field without `accessor` fails when the class
is defined; a test that imports such a class catches it.

The root `tsconfig.json` checks the tooling files. It has `checkJs`, so the
Vite config and the build plugins are type-checked too; give their function
parameters JSDoc types.

## Lint and CI

### Biome

`biome.jsonc` has the formatter, import groups and rules of Freelens. Two
overrides are specific to how the extension is laid out:

- `style/noRestrictedImports` keeps `vitest` and the testing helpers of React
  out of the extension's code (see "Tests and tooling").
- `correctness/noNodejsModules` rejects a Node builtin import in
  `src/renderer/` and `src/common/`, tests left out. It flags the import in the
  editor, before `pnpm type:check` does; it does not see Node globals such as
  `Buffer` or `process`, which only the type check catches.

Every path in an override starts with `**/`. Trunk runs Biome on a copy of the
files in a sandbox outside the repository, and there a path anchored at the
repository root matches no file, so the override silently does nothing. A
plain `biome check` matches both forms, so only `trunk check` shows the
difference.

The Biome commands in `.trunk/trunk.yaml` let Biome find the copy of
`biome.jsonc` in the sandbox rather than pass `--config-path`. Biome 2.6.4
ignores every parser option when the config is given explicitly, with
`--config-path` or `BIOME_CONFIG_PATH`: `markdown.parser.frontmatter` turns
off, and Biome reformats the frontmatter of every `SKILL.md`.

In that sandbox, Biome also cannot apply `vcs.useIgnoreFile`: since 2.5.15 it
matches every target against the repository's `.gitignore` and panics on a
path outside the repository root, so every file fails. The Biome commands in
`.trunk/trunk.yaml` pass `--vcs-use-ignore-file=false`, because Trunk applies
`.gitignore` itself before it picks the targets; `biome.jsonc` keeps the
setting on for `pnpm biome` and editors.

Renovate updates Biome, in the `biome` script and in `.trunk/trunk.yaml`, but
cannot run `biome migrate`. `biome-migrate.yaml` runs it on the Renovate
branch and commits the migrated `biome.jsonc` there, so that the update and its
migration are one pull request. The commit is by `github-actions[bot]`, which
`gitIgnoredAuthors` in `.renovaterc.json` lists, so that Renovate does not take
it for a manual edit and stop updating the branch.

Biome formats SCSS, YAML and Markdown too, as in Freelens, so Trunk runs no
Prettier or markdownlint; yamllint still checks YAML. The Kubernetes manifests
in `examples/` and `integration/fixtures/` are the exception: their sequences
stay unindented, as kubectl writes them, which Biome cannot do, so yamlfmt
formats them with the `.yamlfmt.yaml` of each directory, and the ignore rules
of `.trunk/trunk.yaml` give them to yamlfmt only. `biome.jsonc` leaves them
out, together with `pnpm-lock.yaml` and `pnpm-workspace.yaml`, which pnpm
writes, and `.trunk/`, whose `trunk.yaml` `trunk upgrade` rewrites.

The Markdown rules are in `nursery`. `markdown.parser.frontmatter` is on for
YAML frontmatter in Markdown files; without it Biome reads the opening `---` as
a thematic break and inserts a blank line after it. Biome does not rewrap a
paragraph.

### Knip

`pnpm knip:check` runs knip twice, for unused files and for dependencies: a
development pass over everything, and a `--production --strict` pass over the
code that reaches the bundles, which are the entries marked with `!` in
`knip.jsonc`. In the production pass only `dependencies` count, so a bundled
library that the extension's code imports belongs there. The host-provided
modules are devDependencies, for their types, and are ignored.

A file is unused when no entry reaches it: a leftover module, a barrel that
nothing imports. The production pass starts from the `!` entries only, so it
also reports a module that only tests import. The fix is to remove the file,
not to ignore it. The check does not include unused exports and types: on this
tree they are mostly the exported spec and status types of the models.

`knip.jsonc` lists the entries knip cannot find: the two source entries, the
Vitest alias target `test/freelens-extensions.ts` and the probes in
`environment-tests/`. Its Vite plugin is off: it adds the renderer entry of
`vite.config.mjs` as a development entry, which displaces
`src/renderer/index.tsx!`, and the production pass then skips the renderer.
`--no-config-hints` is set because one config serves both passes, and an entry
that only the production pass needs is reported as redundant by the other.

Two more settings keep the file check to real findings. `project` leaves out
the CSS module declarations with `!src/**/*.d.scss.ts`: TypeScript reaches them
through `allowArbitraryExtensions`, while knip resolves
`import styles from "./x.module.scss"` to the stylesheet, so nothing would
import them. The negation has no trailing `!`, which would apply it to the
production pass only. And the SVGO plugin is on (`"svgo": true`), so that
`svgo.config.mjs` is an entry: Trunk runs SVGO, and no dependency turns the
plugin on.

`ignore` leaves out `dist/**`. The `main` field of `package.json` makes
`dist/main.js` an entry once it exists, and the `knip` script runs with
`--no-gitignore`, so after `pnpm build`, which `check.yaml` runs first, knip
would analyse the bundle and report what it inlines from the libraries it
bundles: a `spawnSync("wsl.exe")` in a bundled `@kubernetes/client-node` comes
out as `Unlisted binaries: wsl.exe dist/main.js`. Run `pnpm knip:check` after a
build when changing `knip.jsonc`, as `check.yaml` does; without `dist/` the
problem does not show.

### Workflows

| Workflow               | Runs                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `type-check.yaml`      | `pnpm type:check`                                                                                   |
| `check.yaml`           | `pnpm build`, `pnpm lint:check`, `pnpm knip:check`                                                  |
| `unit-tests.yaml`      | `pnpm test:unit`                                                                                    |
| `trunk-check.yaml`     | `trunk check --all`                                                                                 |
| `mise-lock-check.yaml` | on a change to `mise.lock`: no checksum changed for an unchanged tool version                       |
| `cleanup-cache.yaml`   | on a closed pull request: deletes the caches of its merge ref                                       |
| `release.yaml`         | on a `v*` tag: type check, tests, build, pack with `.tgz.sha256`, npm stage publish, GitHub release |

The type check has a workflow of its own, as in Freelens, so that a type error
shows as its own failed check rather than as a failed build. `check.yaml`
builds without the type check for the same reason, so it does not run twice.

`release.yaml` fails when the tag does not match `version` in `package.json`.
It packs `thcraft-freelens-pod-file-browser-<version>.tgz` and writes its
`sha256sum` line into `<tarball>.sha256`: Freelens checks a tarball installed
from a URL against that file next to it. It stages the package on npm with
`npm stage publish` and trusted publishing: the job has `id-token: write`, npm
exchanges the OIDC token for a short-lived token, and the repository keeps no
npm token. The trusted publisher on npmjs.com (this repository and
`release.yaml`; renaming either breaks it) allows staging only, so the version
stays private until a maintainer approves it under Staged Packages on
npmjs.com, with 2FA; a plain `npm publish` from the workflow fails with
ENEEDAUTH. The dist-tag is fixed when the version is staged: a version with a
suffix goes to `next`, any other to `latest`, which Freelens installs by name.
A version that is on npm already is skipped,
so the first version, published by hand to create the package, still gets its
GitHub release. The release notes are the section of the version in
`CHANGELOG.md`; 0.x versions and versions with a suffix are GitHub
pre-releases. Run by hand, the workflow keeps the tarball as an artifact and
releases nothing. Push one tag at a time: GitHub starts no workflow for a push
of more than three tags.

To release: add a `## <version> (<date>)` section to `CHANGELOG.md`, set the
same version in `package.json`, commit, tag `v<version>` and push the tag, then
approve the staged version on npmjs.com.

## Checking the Extension in Freelens

There are no integration tests: the functional checks of a change run by hand,
against a cluster with a pod whose container has a shell, preferably one with
BusyBox (such as `busybox` or an Alpine image) and one with GNU coreutils
(such as Debian), since the container scripts must work on both. Check
listing, download of a file and of a folder, upload by dialog and by drop,
editing a UTF-8 file and a Windows-1250 file, Permissions, rename and delete,
in the page and in the pod details.

Freelens started with `pnpm dev` from a freelensapp/freelens checkout runs
Electron with `--remoteDebuggingPort 9223`, so an agent can drive the app over
the Chrome DevTools Protocol, with Playwright MCP or a script using
`chromium.connectOverCDP("http://127.0.0.1:9223")`. `browser.close()` of such a
browser closes only the connection. A profile of Freelens dev syncs no
kubeconfig until one is added in "Kubeconfig Syncs" of the Kubernetes
preferences; `KUBECONFIG` does not change that. An installed Freelens can load
the checkout as well, but has no debugging port.

### Installing the checkout

1. `pnpm install`, then `pnpm build`. After a branch switch, `node_modules`
   can still hold another stack, and Freelens loads the extension from
   `dist/`.
2. On the Extensions page, enter the checkout's directory and press
   "Install". Freelens then asks whether to load the extension in place;
   confirm that too. The table lists the extension as enabled, with
   "development" in the version column and `Loaded from <directory>` in its
   title.
3. A rebuild, by `pnpm build` or by `pnpm dev` of the extension, reloads it
   once in the root frame and once in each cluster frame.

### Driving the UI

- Every cluster renders in a cross-origin `<clusterId>.renderer.freelens.app`
  iframe. Pages, menus and details of the extension live in that frame, not
  in the main page.
- Pages of the extension have URLs like `/extension/<name>/<pageId>`, with the
  package name's `@` dropped and `/` turned into `--`, here
  `/extension/thcraft--freelens-pod-file-browser/pod-files`. The sidebar entries
  navigate in `onClick`; their `href` is not the page URL. A click on an
  entry's `[data-testid="sidebar-item-…"]` element does not navigate; a DOM
  `click()` on the link inside it, `[data-testid="link-for-sidebar-item-…"]`,
  does. Neither does `history.pushState` in the cluster frame.
- The root frame navigates with `Renderer.Navigation.navigate(url)` of the
  extension API, run in its page: `/extensions`, `/catalog`,
  `/preferences/extension/<name>`, `/cluster/<id>`. The application menu
  belongs to the main process, which CDP does not reach.
- Playwright's actionability checks can fail on the hotbar, where
  `#ScrollSpyRoot` intercepts pointer events; a DOM `click()` on the element
  works.
- Views fill in once the host's stores have loaded. Wait for the expected
  content, not a fixed time, before deciding that a page is empty.

### Reading the console

The renderer console also carries the output of Freelens's terminal dock
(`%cMESSAGE` lines), which can include the user's shell prompt, account names
and paths. Keep only warnings, errors, page errors and the extension's own
lines, and never paste the full console into a PR, an issue or a report.
React reports key problems as console errors ("Each child in a list should
have a unique key", "Encountered two children with the same key"); they count
as failures of the "no error in DevTools" check.

The renderer's requests to Kubernetes go through Chromium, which logs every
response that is not a success as a console error,
`Failed to load resource: the server responded with a status of N`, also one
that the code that sent it handles. The text names no URL; the location of the
message does. An
extension whose tests expect such a response on purpose, a 404 or a 409, leaves
out that one error by its status and URL, not every "Failed to load resource".

The main process logs to the terminal running Freelens, and to a file. On
macOS it is `~/Library/Logs/Freelens/lens.log`, with the renderer's
`lens-renderer-*.log` next to it; when the terminal is not at hand, it shows
the extension's activation, its reloads and its own lines. Filter it as the
console.

## Code Style

- **Biome** formats **TypeScript/TSX, JS, JSON, CSS, SCSS, HTML, YAML, Markdown**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width — use `pnpm biome:fix`
- **Trunk** formats **TOML and shell scripts**, and runs the linters for formats not covered by Biome (yamllint, actionlint, shellcheck) — use `pnpm trunk:fix`
- Import order (enforced by biome organizeImports): built-in modules → `@freelensapp/**` → packages → relative paths
- React 19; JSX compiles to `react/jsx-runtime` imports, which the build maps to the host's React
- **No emoji** in Markdown files (`.md`), comments, or any source code

## Security

Never read, display, reference, or include the contents of the following files in any response or context, even if they are open in the editor:

- `.env`
- `.env.*`
- `.envrc`
- `.npmrc`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pfx`
- `*.pem`
- `*.key`

The same list is git-ignored in `.gitignore` and enforced for Claude Code by
the `permissions.deny` rules in `.claude/settings.json`, which block reading
and editing these files. Change all three together. The rules are native
permissions rather than a hook on purpose: a hook runs a process in the
working tree, which may be an untrusted pull request, and an interpreter such
as `python3 -c` imports modules from that tree before the hook's own code.

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`) — Node.js environment, extension lifecycle, cluster connectivity
- **Renderer process** (`src/renderer/`) — Chromium browser, UI components

Code in `src/common/` is shared between both processes.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`dist/`, `node_modules/`)
2. Full clean and rebuild: `pnpm clean:all && pnpm install && pnpm build`
3. With a directory install and `pnpm dev` running, look for a refused reload in the Freelens log, and restart
   Freelens after a change to `main` or `renderer` in `package.json`; reinstall an extension installed from a tarball

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches the `engines` field in `package.json`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors
2. Check the terminal where Freelens was launched for main process errors
3. Look for stack traces with file:line numbers
4. Verify all CRD objects have proper `static readonly` properties (kind, apiBase, crd)
5. Validate both with `pnpm type:check` **and** `pnpm build` — runtime failures can appear only in bundled `dist/` code

## Best Practices

1. **Use semantic search** to find examples and patterns in the codebase
2. **Follow existing patterns** — grep for similar implementations before creating new ones
3. **Test changes** before committing
4. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
5. **For TypeScript/TSX, JS, JSON, CSS, SCSS, HTML, YAML and Markdown files:** run `pnpm biome:fix` (or `biome check` directly if `biome` is installed locally)
6. **For other formats:** run `pnpm trunk:fix` (or `trunk check` directly if `trunk` is installed locally)
7. **Full build** when in doubt about cached state: `pnpm clean:all && pnpm install && pnpm build`
8. **Do not use Anthropic Fable for coding tasks** — Fable may be used only for planning,
   analysis, and thinking through problems. When writing or editing code,
   use standard editing tools instead.
