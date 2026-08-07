import { describe, it, expect } from "vitest";
import { imageBlock, sniffImageType } from "../lib/claude";

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);
const WEBP = b64([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);

describe("sniffImageType", () => {
  it("reads the format off the magic number", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF)).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("returns null rather than guessing", () => {
    expect(sniffImageType("")).toBeNull();
    expect(sniffImageType(b64([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("imageBlock", () => {
  // The API rejects a mismatch with a 400 and the whole call is lost. A
  // screenshot's format depends on who took it: Playwright defaults to PNG,
  // chrome.tabs.captureVisibleTab returns JPEG, a CDP screencast frame is JPEG.
  it("declares what the bytes are, not what the caller assumed", () => {
    const block = imageBlock(JPEG); // caller's default says png
    expect(block.source).toMatchObject({ media_type: "image/jpeg" });
  });

  it("overrides a caller that explicitly got it wrong", () => {
    const block = imageBlock(PNG, "image/jpeg");
    expect(block.source).toMatchObject({ media_type: "image/png" });
  });

  it("falls back to the caller's type when the signature is unknown", () => {
    const block = imageBlock(b64([1, 2, 3, 4, 5, 6, 7, 8]), "image/jpeg");
    expect(block.source).toMatchObject({ media_type: "image/jpeg" });
  });
});
