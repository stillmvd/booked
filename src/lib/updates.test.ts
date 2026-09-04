import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeUpdateError, formatBytes, formatProgress, shouldCheck } from "./updates.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("shouldCheck", () => {
  it("проверяет, если ещё ни разу не проверяли", () => {
    assert.equal(shouldCheck(null, 1_000_000), true);
  });

  it("не проверяет раньше суток", () => {
    assert.equal(shouldCheck(DAY, DAY + DAY - 1), false);
  });

  it("проверяет ровно через сутки и позже", () => {
    assert.equal(shouldCheck(DAY, DAY + DAY), true);
    assert.equal(shouldCheck(DAY, DAY * 5), true);
  });

  it("проверяет, если часы ушли назад", () => {
    assert.equal(shouldCheck(DAY * 3, DAY), true);
  });
});

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

describe("describeUpdateError", () => {
  it("сеть, подпись, отсутствие списка и всё остальное", () => {
    assert.match(describeUpdateError(new Error("error sending request for url")), /Нет сети/);
    assert.match(describeUpdateError("dns error: failed to lookup"), /Нет сети/);
    assert.match(describeUpdateError("invalid signature"), /Подпись/);
    assert.match(describeUpdateError("404 Not Found"), /нет списка версий/);
    assert.equal(describeUpdateError("something odd"), "Не удалось проверить обновления");
  });
});
