import test from "node:test";
import assert from "node:assert/strict";

import {
  devStatusLabel,
  formatSiteStamp,
  formatSize,
  MANUAL_STATUS_GROUPS,
  splitExePath,
  STATUS_LABELS,
  STATUS_ORDER,
  updateDay,
  updateLabel,
  runLabel,
  withV,
  downloadPostIndex,
} from "./gameFormat.ts";

test("download opens the first F95 post link, old direct links are skipped", () => {
  const post = { url: "https://f95zone.to/dl/16395708/?u=2516778&k=45a82b953451&r=1792662785&t=Xiuw5kt4Xsg4TEdn" };
  assert.equal(downloadPostIndex([{ url: "https://datanodes.to/3hc7x2lq/game.zip" }, post]), 1);
  assert.equal(downloadPostIndex([{ url: "https://f95zone.to/masked/mega.nz/2/1840331/k7Qx" }]), -1);
  assert.equal(downloadPostIndex([]), -1);
});

test("time in a running game reads in whole minutes and hours", () => {
  const start = 1_000_000;
  assert.equal(runLabel(start, start + 30_000), "Идёт");
  assert.equal(runLabel(start, start + 12 * 60_000 + 59_000), "Идёт 12 мин");
  assert.equal(runLabel(start, start + 60 * 60_000), "Идёт 1 ч");
  assert.equal(runLabel(start, start + 65 * 60_000), "Идёт 1 ч 5 мин");
  assert.equal(runLabel(start, start - 5_000), "Идёт");
});

test("site development status reads in Russian", () => {
  assert.equal(devStatusLabel("Completed"), "Завершена");
  assert.equal(devStatusLabel("On hold"), "Заморожена");
  assert.equal(devStatusLabel("Abandoned"), "Заброшена");
  assert.equal(devStatusLabel("Ongoing"), "В разработке");
  assert.equal(devStatusLabel(" Beta "), "Beta");
  assert.equal(devStatusLabel(null), "");
});

test("six statuses, wish is never chosen by hand", () => {
  assert.deepEqual(
    STATUS_ORDER.map((status) => STATUS_LABELS[status]),
    ["Хочу", "Не начата", "Прохожу", "Пройдена", "Жду обновлений", "Не понравилась"],
  );
  assert.deepEqual(MANUAL_STATUS_GROUPS.flat(), STATUS_ORDER.filter((status) => status !== "wish"));
});

test("update history day reads in Russian", () => {
  const now = new Date(2026, 8, 30, 12).getTime();
  assert.equal(updateDay(new Date(2026, 8, 12, 12).getTime() / 1000, now), "12 сентября");
  assert.equal(updateDay(new Date(2025, 11, 31, 12).getTime() / 1000, now), "31 декабря 2025 г.");
});

test("prefixes numeric versions with v", () => {
  assert.equal(withV("0.8.12r1"), "v0.8.12r1");
  assert.equal(withV("Beta 3"), "Beta 3");
  assert.equal(withV("2026.06.15"), "v2026.06.15");
});

test("splits exe path into file name and its folder", () => {
  assert.deepEqual(splitExePath("AHouseInTheRift.exe"), { name: "AHouseInTheRift.exe", folder: "" });
  assert.deepEqual(splitExePath("lib\\py3-windows-x86_64\\pythonw.exe"), {
    name: "pythonw.exe",
    folder: "lib\\py3-windows-x86_64",
  });
  assert.deepEqual(splitExePath("bin/Игра.exe"), { name: "Игра.exe", folder: "bin" });
  assert.deepEqual(splitExePath("папка\\"), { name: "папка\\", folder: "папка" });
});

test("formats folder size with russian decimal comma", () => {
  assert.equal(formatSize(0), "0 Б");
  assert.equal(formatSize(512), "512 Б");
  assert.equal(formatSize(1024), "1 КБ");
  assert.equal(formatSize(4_509_715_660), "4,2 ГБ");
  assert.equal(formatSize(null), "");
  assert.equal(formatSize(-5), "");
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
  assert.equal(updateLabel("f95", "Ch. 3", "1.0", now), "На сайте что-то вышло: Ch. 3");
  assert.equal(updateLabel("f95", "2026.07.02", "2026.06.15", now), "Вышла 2026.07.02, у вас 2026.06.15");
});
