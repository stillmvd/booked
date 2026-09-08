import test from "node:test";
import assert from "node:assert/strict";

import { formatLastLaunched, formatSiteStamp, formatSize, plural, updateLabel } from "./gameFormat.ts";

test("formats folder size with russian decimal comma", () => {
  assert.equal(formatSize(0), "0 Б");
  assert.equal(formatSize(512), "512 Б");
  assert.equal(formatSize(1024), "1 КБ");
  assert.equal(formatSize(4_509_715_660), "4,2 ГБ");
  assert.equal(formatSize(null), "");
  assert.equal(formatSize(-5), "");
});

test("plural picks russian form by last digits", () => {
  assert.equal(plural(1, "день", "дня", "дней"), "день");
  assert.equal(plural(3, "день", "дня", "дней"), "дня");
  assert.equal(plural(11, "день", "дня", "дней"), "дней");
  assert.equal(plural(21, "день", "дня", "дней"), "день");
  assert.equal(plural(114, "день", "дня", "дней"), "дней");
});

test("describes last launch in plain words", () => {
  const now = Date.UTC(2026, 8, 8, 12, 0, 0);
  const day = 86_400_000;
  assert.equal(formatLastLaunched(null, now), "Ещё не запускалась");
  assert.equal(formatLastLaunched((now - day / 2) / 1000, now), "Запускалась сегодня");
  assert.equal(formatLastLaunched((now - day) / 1000, now), "Запускалась вчера");
  assert.equal(formatLastLaunched((now - 3 * day) / 1000, now), "Запускалась 3 дня назад");
  assert.equal(formatLastLaunched((now - 70 * day) / 1000, now), "Запускалась 2 месяца назад");
  assert.equal(formatLastLaunched((now - 800 * day) / 1000, now), "Запускалась 2 года назад");
});

test("formats site stamp as russian date", () => {
  const now = Date.UTC(2026, 8, 8);
  assert.equal(formatSiteStamp("2026-09-04T14:11Z", now), "4 сентября");
  assert.equal(formatSiteStamp("2024-01-31T00:00Z", now), "31 января 2024 г.");
  assert.equal(formatSiteStamp(null, now), "");
  assert.equal(formatSiteStamp("не дата", now), "");
});

test("update label differs for f95 and itch", () => {
  const now = Date.UTC(2026, 8, 8);
  assert.equal(updateLabel("f95", "0.6.0", "0.5.2", now), "Вышла 0.6.0, у вас 0.5.2");
  assert.equal(updateLabel("f95", "0.6.0", null, now), "На сайте 0.6.0");
  assert.equal(updateLabel("itch", "2026-09-04T14:11Z", null, now), "Обновлено 4 сентября");
  assert.equal(updateLabel("f95", null, "0.5.2", now), "");
});
