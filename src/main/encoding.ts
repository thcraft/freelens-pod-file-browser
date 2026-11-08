import iconv from "iconv-lite";
import { TEXT_ENCODINGS, type TextEncoding } from "../common/protocol";

// The byte order mark stays part of the text, as U+FEFF, so that saving writes it back as it was.
const decodeOptions = { stripBOM: false };
const encodeOptions = { addBOM: false };

function startsWith(data: Uint8Array, bytes: number[]) {
  return bytes.every((byte, index) => data[index] === byte);
}

/**
 * The encoding a file opens in when none is asked for: UTF-16 when it starts with a UTF-16 byte order mark, which
 * settles it, and UTF-8 otherwise. Text in another encoding does not convert back to the same bytes as UTF-8, so it
 * opens read only until the user picks its encoding.
 */
export function defaultEncoding(data: Uint8Array): TextEncoding {
  if (startsWith(data, [0xff, 0xfe])) {
    return "utf16le";
  }
  if (startsWith(data, [0xfe, 0xff])) {
    return "utf16be";
  }
  return "utf8";
}

/** NUL bytes outside UTF-16: what text files do not have and nearly every binary format does. */
export function looksBinary(data: Uint8Array, encoding: TextEncoding): boolean {
  return !encoding.startsWith("utf16") && data.includes(0);
}

export function decodeText(data: Uint8Array, encoding: TextEncoding): { content: string; lossless: boolean } {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const content = iconv.decode(buffer, encoding, decodeOptions);
  const lossless = iconv.encode(content, encoding, encodeOptions).equals(buffer);
  return { content, lossless };
}

export class UnencodableTextError extends Error {}

/**
 * The text in the encoding. Throws when it has characters the encoding cannot hold, which iconv-lite would otherwise
 * write as "?" without a word.
 */
export function encodeText(content: string, encoding: TextEncoding): Buffer {
  const encoded = iconv.encode(content, encoding, encodeOptions);
  if (iconv.decode(encoded, encoding, decodeOptions) === content) {
    return encoded;
  }

  const unencodable = new Set<string>();
  for (const character of content) {
    if (iconv.decode(iconv.encode(character, encoding, encodeOptions), encoding, decodeOptions) !== character) {
      unencodable.add(character);
      if (unencodable.size === 5) {
        break;
      }
    }
  }
  const list = [...unencodable]
    .map((character) => `"${character}" (U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")})`)
    .join(", ");
  const label = TEXT_ENCODINGS.find((entry) => entry.id === encoding)?.label ?? encoding;
  throw new UnencodableTextError(`The file is in ${label}, which cannot hold ${list}. Remove them to save it.`);
}
