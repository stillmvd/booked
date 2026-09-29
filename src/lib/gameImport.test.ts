import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isArchivePath, pageUrlProblem, sourceName } from "./gameImport.ts";

describe("pageUrlProblem", () => {
  it("пустая ссылка — не ошибка, её можно пропустить", () => {
    assert.equal(pageUrlProblem("  "), null);
  });

  it("принимает F95zone и itch.io с поддоменами", () => {
    assert.equal(pageUrlProblem("https://f95zone.to/threads/the-ruined-bloom-v0-6-2-cungduts.273556/"), null);
    assert.equal(pageUrlProblem("https://cungduts.itch.io/the-ruined-bloom"), null);
  });

  it("отказывает чужим сайтам и мусору", () => {
    assert.match(pageUrlProblem("https://example.com/game") ?? "", /F95zone или itch\.io/);
    assert.match(pageUrlProblem("f95zone.to/threads/x") ?? "", /не похоже на ссылку/);
    assert.match(pageUrlProblem("https://notitch.io/x") ?? "", /F95zone или itch\.io/);
  });
});

describe("sourceName / isArchivePath", () => {
  it("берёт последнее имя пути Windows", () => {
    assert.equal(sourceName("C:\\Users\\me\\Downloads\\TheRuinedBloomv0.6.2-pc.zip"), "TheRuinedBloomv0.6.2-pc.zip");
    assert.equal(sourceName("D:\\Игры\\Папка\\"), "Папка");
  });

  it("узнаёт zip, rar и 7z в любом регистре", () => {
    assert.equal(isArchivePath("a.ZIP"), true);
    assert.equal(isArchivePath("Apocalypse_with_Femboy_v1.0.rar"), true);
    assert.equal(isArchivePath("Game.7z"), true);
    assert.equal(isArchivePath("D:\\Игра"), false);
  });
});
