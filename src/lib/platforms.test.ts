import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { HIGHLIGHT_CLOSE, HIGHLIGHT_OPEN } from "./highlight.ts";
import { PLATFORM_DOMAINS, displayLabel, isMultiLink, linkCountLabel, linkHint, platformForUrl, splitTitle } from "./platforms.ts";

test("словарь площадок совпадает с ядром построчно", () => {
  const rust = fs.readFileSync("src-tauri/core/src/links.rs", "utf8");
  const start = rust.indexOf("PLATFORM_DOMAINS");
  const block = rust.slice(start, rust.indexOf("];", start));
  const core = [...block.matchAll(/\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.ok(core.length > 20);
  assert.deepEqual(
    PLATFORM_DOMAINS.map((row) => [...row]),
    core,
  );
});

test("площадка по адресу учитывает www, m. и поддомены", () => {
  assert.equal(platformForUrl("https://www.instagram.com/anya")?.key, "instagram");
  assert.equal(platformForUrl("https://m.vk.com/id1")?.key, "vk");
  assert.equal(platformForUrl("https://anya.tumblr.com/")?.key, "tumblr");
  assert.equal(platformForUrl("https://T.ME/anya")?.name, "Telegram");
  assert.equal(platformForUrl("https://notinstagram.com/"), null);
  assert.equal(platformForUrl("не адрес"), null);
});

test("подпись: своя, площадка, иначе домен", () => {
  assert.equal(displayLabel("https://t.me/anya", "  Канал  "), "Канал");
  assert.equal(displayLabel("https://dzen.ru/anya", null), "Дзен");
  assert.equal(displayLabel("https://www.anya-draws.ru/shop", "   "), "anya-draws.ru");
});

test("склонение числа ссылок", () => {
  assert.equal(linkCountLabel(2), "2 ссылки");
  assert.equal(linkCountLabel(5), "5 ссылок");
  assert.equal(linkCountLabel(11), "11 ссылок");
  assert.equal(linkCountLabel(21), "21 ссылка");
  assert.equal(linkCountLabel(23), "23 ссылки");
});

test("вид с несколькими ссылками — от двух", () => {
  assert.equal(isMultiLink({ links: [1] }), false);
  assert.equal(isMultiLink({ links: [1, 2] }), true);
});

test("имя делится на первое слово и остальное", () => {
  assert.deepEqual(splitTitle("Аня Верес"), { light: "Аня", bold: "Верес" });
  assert.deepEqual(splitTitle("Мира Лис из Питера"), { light: "Мира", bold: "Лис из Питера" });
  assert.deepEqual(splitTitle("anya.draws"), { light: "", bold: "anya.draws" });
  assert.deepEqual(splitTitle("Аня "), { light: "", bold: "Аня " });
});

test("подсветка поиска, накрывшая пробел, не рвётся", () => {
  const marked = `${HIGHLIGHT_OPEN}Аня Верес${HIGHLIGHT_CLOSE}`;
  assert.deepEqual(splitTitle(marked), {
    light: `${HIGHLIGHT_OPEN}Аня${HIGHLIGHT_CLOSE}`,
    bold: `${HIGHLIGHT_OPEN}Верес${HIGHLIGHT_CLOSE}`,
  });
  const partial = `Аня ${HIGHLIGHT_OPEN}Вер${HIGHLIGHT_CLOSE}ес`;
  assert.deepEqual(splitTitle(partial), { light: "Аня", bold: `${HIGHLIGHT_OPEN}Вер${HIGHLIGHT_CLOSE}ес` });
});

test("подсказка справа от ссылки: ник, путь или адрес", () => {
  assert.equal(linkHint("https://www.instagram.com/anya.draws/", "instagram", false), "@anya.draws");
  assert.equal(linkHint("https://www.youtube.com/@anya", "youtube", false), "@anya");
  assert.equal(linkHint("https://www.youtube.com/watch?v=abc", "youtube", false), "watch?v=abc");
  assert.equal(linkHint("https://vk.com/", "vk", false), "vk.com");
  assert.equal(linkHint("https://www.artstation.com/anyaveres", null, false), "/anyaveres");
  assert.equal(linkHint("https://anya.example.com/", null, false), "");
  assert.equal(linkHint("https://shop.example.com/anya", null, true), "shop.example.com/anya");
  assert.equal(linkHint("https://t.me/%D0%B0%D0%BD%D1%8F", "telegram", false), "@аня");
  assert.equal(linkHint("https://t.me/%E0%A4%A", "telegram", false), "@%E0%A4%A");
  assert.equal(linkHint("https://t.me/%2Fanya", "telegram", false), "@/anya");
});
