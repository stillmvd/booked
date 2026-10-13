import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cloudStateText, maskedKey } from "./cloud.ts";
import type { CloudStatus } from "./types.ts";

const status = (state: CloudStatus["state"], pending = 0): CloudStatus => ({
  url: "https://booked-cloud.mozhno-sync.workers.dev",
  keyTail: "1234",
  state,
  pending,
  lastSync: null,
});

describe("cloudStateText", () => {
  it("называет каждое состояние обычными словами", () => {
    assert.equal(cloudStateText(status("off")), "Облако не подключено");
    assert.equal(cloudStateText(status("ok")), "Подключено");
    assert.equal(cloudStateText(status("badKey")), "Неверный ключ");
    assert.equal(cloudStateText(status("offline")), "Нет связи");
  });

  it("показывает очередь, пока она не ушла", () => {
    assert.equal(cloudStateText(status("ok", 3)), "Ждут отправки: 3");
    assert.equal(cloudStateText(status("offline", 3)), "Нет связи · ждут отправки: 3");
    assert.equal(cloudStateText(status("off", 3)), "Облако не подключено");
  });
});

describe("maskedKey", () => {
  it("ключ виден только хвостом", () => {
    assert.equal(maskedKey("1234"), "••••1234");
    assert.equal(maskedKey(null), "");
  });
});
