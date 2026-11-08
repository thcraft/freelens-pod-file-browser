import { describe, expect, it } from "vitest";
import { decodeText, defaultEncoding, encodeText, looksBinary, UnencodableTextError } from "./encoding";

// "Příliš žluťoučký kůň" in Windows-1250, with the Czech letters as single bytes.
const czechWindows1250 = Buffer.from([
  0x50, 0xf8, 0xed, 0x6c, 0x69, 0x9a, 0x20, 0x9e, 0x6c, 0x75, 0x9d, 0x6f, 0x75, 0xe8, 0x6b, 0xfd, 0x20, 0x6b, 0xf9,
  0xf2,
]);

describe("defaultEncoding and looksBinary", () => {
  it("opens everything as UTF-8 but UTF-16 with its byte order mark", () => {
    expect(defaultEncoding(Buffer.from("Příliš žluťoučký kůň", "utf8"))).toBe("utf8");
    expect(defaultEncoding(czechWindows1250)).toBe("utf8");
    expect(defaultEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe("utf8");
    expect(defaultEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00]))).toBe("utf16le");
    expect(defaultEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61]))).toBe("utf16be");
  });

  it("takes NUL bytes for binary, except in UTF-16", () => {
    expect(looksBinary(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), "utf8")).toBe(true);
    expect(looksBinary(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), "iso88591")).toBe(true);
    expect(looksBinary(Buffer.from([0xff, 0xfe, 0x61, 0x00]), "utf16le")).toBe(false);
    expect(looksBinary(czechWindows1250, "utf8")).toBe(false);
  });
});

describe("decodeText and encodeText", () => {
  it("round-trips a single-byte encoding to the same bytes", () => {
    const { content, lossless } = decodeText(czechWindows1250, "windows1250");
    expect(content).toBe("Příliš žluťoučký kůň");
    expect(lossless).toBe(true);
    expect(encodeText(`${content}!`, "windows1250").equals(Buffer.concat([czechWindows1250, Buffer.from("!")]))).toBe(
      true,
    );
  });

  it("keeps a byte order mark", () => {
    const withBom = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
    const { content, lossless } = decodeText(withBom, "utf8");
    expect(lossless).toBe(true);
    expect(encodeText(content, "utf8").equals(withBom)).toBe(true);
  });

  it("reads any bytes as Latin-1 without loss", () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte));
    expect(decodeText(all, "iso88591").lossless).toBe(true);
  });

  it("reports when bytes do not convert back, as UTF-8 that is not valid", () => {
    expect(decodeText(czechWindows1250, "utf8").lossless).toBe(false);
  });

  it("refuses characters the encoding cannot hold and names them", () => {
    expect(() => encodeText("cena 10 €", "iso88592")).toThrow(UnencodableTextError);
    expect(() => encodeText("cena 10 €", "iso88592")).toThrow(/U\+20AC/);
    expect(encodeText("cena 10 €", "windows1250").length).toBe(9);
  });
});
