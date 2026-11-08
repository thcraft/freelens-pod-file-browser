import { describe, expect, it } from "vitest";
import { localNameFor } from "./local-names";

describe("localNameFor", () => {
  it("keeps ordinary names and archives directories as .tar.gz", () => {
    expect(localNameFor({ path: "/var/log/app.log", isDirectory: false })).toBe("app.log");
    expect(localNameFor({ path: "/var/log", isDirectory: true })).toBe("log.tar.gz");
    expect(localNameFor({ path: "/", isDirectory: true })).toBe("root.tar.gz");
  });

  it("makes names Windows refuses or changes safe", () => {
    expect(localNameFor({ path: "/data/a:b?c", isDirectory: false })).toBe("a_b_c");
    expect(localNameFor({ path: "/dev/null", isDirectory: false })).toBe("null");
    expect(localNameFor({ path: "/data/NUL", isDirectory: false })).toBe("_NUL");
    expect(localNameFor({ path: "/data/CON.txt", isDirectory: false })).toBe("_CON.txt");
    expect(localNameFor({ path: "/data/com1", isDirectory: true })).toBe("_com1.tar.gz");
    expect(localNameFor({ path: "/data/name. ", isDirectory: false })).toBe("name__");
  });
});
