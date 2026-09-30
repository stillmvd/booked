import { test } from "node:test";
import assert from "node:assert/strict";

import { asImagePick, carriesImage, classifyDrop, imageInHtml, onlyImageFiles, pickImageFile, pickImageUrl, looksLikeImageUrl } from "./imageSource.ts";
import type { DropData } from "./imageSource.ts";

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

function drop(parts: Partial<DropData>): DropData {
  return { files: null, items: null, uriList: "", text: "", html: "", ...parts };
}

test("classifyDrop takes an image file from explorer first", () => {
  const png = fakeFile("image/png");
  const got = classifyDrop(drop({ files: [png] as unknown as FileList, uriList: "https://example.com/page" }));
  assert.deepEqual(got, { kind: "file", file: png });
});

test("classifyDrop treats a Chrome image wrapped in a link as the image, not the link", () => {
  const got = classifyDrop(
    drop({
      uriList: "https://site.test/gallery/42",
      text: "https://site.test/gallery/42",
      html: '<a href="https://site.test/gallery/42"><img alt="x" src="https://cdn.site.test/i/42?w=800&amp;h=600"></a>',
    }),
  );
  assert.deepEqual(got, { kind: "imageUrl", url: "https://cdn.site.test/i/42?w=800&h=600" });
});

test("classifyDrop reads a Firefox-style image with single quotes", () => {
  const got = classifyDrop(drop({ uriList: "https://cdn.test/cover", html: "<img src='https://cdn.test/cover'>" }));
  assert.deepEqual(got, { kind: "imageUrl", url: "https://cdn.test/cover" });
});

test("classifyDrop turns a plain page link into an address", () => {
  const got = classifyDrop(
    drop({ uriList: "https://f95zone.to/threads/game.1/", html: '<a href="https://f95zone.to/threads/game.1/">Game</a>' }),
  );
  assert.deepEqual(got, { kind: "link", url: "https://f95zone.to/threads/game.1/" });
});

test("classifyDrop treats a link to an image file as the image", () => {
  assert.deepEqual(classifyDrop(drop({ uriList: "https://example.com/a.webp" })), {
    kind: "imageUrl",
    url: "https://example.com/a.webp",
  });
});

test("classifyDrop ignores non-image files and empty drops", () => {
  assert.deepEqual(classifyDrop(drop({ files: [fakeFile("application/pdf")] as unknown as FileList })), { kind: "none" });
  assert.deepEqual(classifyDrop(drop({ text: "просто текст" })), { kind: "none" });
  assert.deepEqual(classifyDrop(drop({})), { kind: "none" });
});

test("imageInHtml skips data and relative sources", () => {
  assert.equal(imageInHtml('<img src="data:image/png;base64,AAAA">'), null);
  assert.equal(imageInHtml('<img src="/local.png">'), null);
  assert.equal(imageInHtml("<p>нет картинки</p>"), null);
});

function item(kind: string, type: string) {
  return { kind, type };
}

test("carriesImage sees an image file item", () => {
  assert.equal(carriesImage(["Files"], [item("file", "image/png")]), true);
});

test("carriesImage rejects an archive", () => {
  assert.equal(carriesImage(["Files"], [item("file", "application/zip")]), false);
});

test("carriesImage rejects a link from the browser", () => {
  const types = ["text/uri-list", "text/plain", "text/html"];
  assert.equal(carriesImage(types, [item("string", "text/uri-list"), item("string", "text/html")]), false);
});

test("carriesImage accepts a browser image with an untyped file and html", () => {
  const types = ["Files", "text/uri-list", "text/html"];
  assert.equal(carriesImage(types, [item("file", ""), item("string", "text/html")]), true);
});

test("carriesImage rejects an untyped file without html", () => {
  assert.equal(carriesImage(["Files"], [item("file", "")]), false);
});

test("onlyImageFiles is true only when every file is an image", () => {
  assert.equal(onlyImageFiles([item("file", "image/png"), item("file", "image/jpeg")]), true);
  assert.equal(onlyImageFiles([item("file", "image/png"), item("file", "application/zip")]), false);
  assert.equal(onlyImageFiles([item("file", "")]), false);
  assert.equal(onlyImageFiles([]), false);
});

test("asImagePick keeps images and drops links", () => {
  assert.deepEqual(asImagePick({ kind: "imageUrl", url: "https://a.b/c.png" }), { kind: "imageUrl", url: "https://a.b/c.png" });
  assert.equal(asImagePick({ kind: "link", url: "https://a.b" }), null);
  assert.equal(asImagePick({ kind: "none" }), null);
});
