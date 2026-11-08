import { baseName, type DownloadItem } from "../common/protocol";

// A name Windows takes for a device (CON, NUL, COM1...) gets an underscore in front, and the dots and spaces it
// would trim from the end of a name are replaced.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function localNameFor(item: DownloadItem) {
  let name = baseName(item.path)
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, (trailing) => "_".repeat(trailing.length));
  if (name === "/") {
    name = "root";
  }
  if (WINDOWS_RESERVED.test(name)) {
    name = `_${name}`;
  }
  return item.isDirectory ? `${name}.tar.gz` : name;
}
