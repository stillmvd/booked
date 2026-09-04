import { test } from "node:test";
import assert from "node:assert/strict";

import { pickImageFile, pickImageUrl, looksLikeImageUrl } from "./imageSource.ts";

function fakeFile(type: string, name = "x"): File {
  return { type, name } as File;
}

test("pickImageFile takes the first image out of a file list", () => {
  const list = [fakeFile("text/plain"), fakeFile("image/png"), fakeFile("image/jpeg")] as unknown as FileList;
  assert.equal(pickImageFile(list)?.type, "image/png");
});

test("pickImageFile falls back to transfer items when the file list is empty", () => {
  const png = fakeFile("image/png");
  const items = [
    { kind: "string", type: "text/html", getAsFile: () => null },
    { kind: "file", type: "image/png", getAsFile: () => png },
  ] as unknown as DataTransferItemList;
  assert.equal(pickImageFile(null, items), png);
});

test("pickImageFile ignores non-image items", () => {
  const items = [{ kind: "file", type: "application/pdf", getAsFile: () => fakeFile("application/pdf") }] as unknown as DataTransferItemList;
  assert.equal(pickImageFile(undefined, items), null);
});

test("pickImageUrl reads the first meaningful line of uri-list", () => {
  assert.equal(pickImageUrl("# comment\r\nhttps://example.com/a.png\r\n", ""), "https://example.com/a.png");
});

test("pickImageUrl falls back to plain text", () => {
  assert.equal(pickImageUrl("", "  https://example.com/b.jpg "), "https://example.com/b.jpg");
});

test("pickImageUrl rejects anything that is not an http address", () => {
  assert.equal(pickImageUrl("", "просто текст"), null);
  assert.equal(pickImageUrl("", "file:///C:/tmp/a.png"), null);
  assert.equal(pickImageUrl("", ""), null);
});

test("looksLikeImageUrl recognizes image extensions with query strings", () => {
  assert.equal(looksLikeImageUrl("https://example.com/a.png?v=2"), true);
  assert.equal(looksLikeImageUrl("https://example.com/a.WEBP#x"), true);
  assert.equal(looksLikeImageUrl("https://example.com/page"), false);
});
