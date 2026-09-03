import { test } from "node:test";
import assert from "node:assert/strict";

import { userMessage } from "./userMessage.ts";

const original = console.error;
console.error = () => {};
test.after(() => {
  console.error = original;
});

test("userMessage translates known error codes", () => {
  assert.equal(userMessage("cycle"), "Нельзя перенести папку в саму себя или в её содержимое");
});

test("userMessage keeps human text from the core", () => {
  assert.equal(userMessage("Файл слишком большой для импорта"), "Файл слишком большой для импорта");
  assert.equal(userMessage(new Error("Не удалось прочитать файл")), "Не удалось прочитать файл");
});

test("userMessage hides technical text", () => {
  const fallback = "Не получилось сохранить. Попробуйте ещё раз.";
  assert.equal(userMessage("database is locked"), fallback);
  assert.equal(userMessage(new Error("SqliteFailure(Error { code: DatabaseBusy })")), fallback);
  assert.equal(userMessage(undefined), fallback);
});
