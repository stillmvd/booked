import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkedAgo, describeUpdateError, formatBytes, formatProgress } from "./updates.ts";

describe("formatBytes / formatProgress", () => {
  it("мелкое в килобайтах, крупное в мегабайтах с одной цифрой", () => {
    assert.equal(formatBytes(512), "1 КБ");
    assert.equal(formatBytes(300 * 1024), "300 КБ");
    assert.equal(formatBytes(9.8 * 1024 * 1024), "9,8 МБ");
  });

  it("прогресс без общего размера показывает только скачанное", () => {
    assert.equal(formatProgress(4.2 * 1024 * 1024, null), "4,2 МБ");
    assert.equal(formatProgress(4.2 * 1024 * 1024, 9.8 * 1024 * 1024), "4,2 МБ из 9,8 МБ");
  });
});

describe("checkedAgo", () => {
  const now = 10 * 86_400_000;
  it("минуты, часы, дни", () => {
    assert.equal(checkedAgo(now - 30_000, now), "Проверено только что");
    assert.equal(checkedAgo(now - 5 * 60_000, now), "Проверено 5 мин назад");
    assert.equal(checkedAgo(now - 3 * 3_600_000, now), "Проверено 3 ч назад");
    assert.equal(checkedAgo(now - 2 * 86_400_000, now), "Проверено 2 дн назад");
  });
});

describe("describeUpdateError", () => {
  it("отказ в UAC, сеть, подпись, отсутствие списка и всё остальное", () => {
    assert.match(describeUpdateError("The operation was canceled by the user. (os error 1223)"), /отменена/);
    assert.match(describeUpdateError(new Error("error sending request for url")), /Нет сети/);
    assert.match(describeUpdateError("dns error: failed to lookup"), /Нет сети/);
    assert.match(describeUpdateError("invalid signature"), /Подпись/);
    assert.match(describeUpdateError("404 Not Found"), /нет списка версий/);
    assert.equal(describeUpdateError("something odd"), "Не удалось обновиться");
  });
});
