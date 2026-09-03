import { test } from "node:test";
import assert from "node:assert/strict";

import { livenessClass, livenessText, livenessTooltip } from "./liveness.ts";

test("dead_status_gives_dead_class", () => {
  assert.equal(livenessClass({ linkStatus: "dead" }), "dead");
});

test("error_status_gives_warn_class", () => {
  assert.equal(livenessClass({ linkStatus: "error" }), "warn");
});

test("gated_status_gives_no_class", () => {
  assert.equal(livenessClass({ linkStatus: "gated" }), null);
});

test("blocked_status_gives_no_class", () => {
  assert.equal(livenessClass({ linkStatus: "blocked" }), null);
});

test("ok_status_gives_no_class", () => {
  assert.equal(livenessClass({ linkStatus: "ok" }), null);
});

test("empty_status_gives_no_class", () => {
  assert.equal(livenessClass({ linkStatus: null }), null);
});

test("throttled_status_gives_no_class", () => {
  assert.equal(livenessClass({ linkStatus: "throttled" }), null);
});

test("dead_text_is_pages_gone", () => {
  assert.equal(livenessText("dead", null, null), "Страницы нет");
});

test("error_timeout_text_is_site_not_responding", () => {
  assert.equal(livenessText("error", "timeout", null), "Сайт не отвечает");
});

test("error_dns_text_is_domain_not_found", () => {
  assert.equal(livenessText("error", "dns", null), "Домен не найден");
});

test("error_tls_text_is_certificate_problem", () => {
  assert.equal(livenessText("error", "tls", null), "Проблема с сертификатом");
});

test("error_refused_text_is_site_unavailable", () => {
  assert.equal(livenessText("error", "refused", null), "Сайт недоступен");
});

test("error_500_text_is_site_unavailable", () => {
  assert.equal(livenessText("error", null, 500), "Сайт недоступен");
});

test("error_404_text_is_pages_gone", () => {
  assert.equal(livenessText("error", null, 404), "Страницы нет");
});

test("error_410_text_is_pages_gone", () => {
  assert.equal(livenessText("error", null, 410), "Страницы нет");
});

test("gated_text_is_unavailable_for_booked", () => {
  assert.equal(livenessText("gated", null, null), "Недоступно для Booked");
});

test("blocked_text_is_unavailable_for_booked", () => {
  assert.equal(livenessText("blocked", null, null), "Недоступно для Booked");
});

test("ok_text_is_opens_normally", () => {
  assert.equal(livenessText("ok", null, null), "Открывается нормально");
});

test("empty_status_text_is_not_checked_yet", () => {
  assert.equal(livenessClass({ linkStatus: null }), null);
  assert.equal(livenessText(null, null, null), "Ещё не проверялось");
});

test("throttled_text_is_null", () => {
  assert.equal(livenessText("throttled", null, null), null);
});

test("tooltip_joins_text_and_date_with_dash", () => {
  const tooltip = livenessTooltip("dead", null, null, 0);
  assert.ok(tooltip?.includes("—"));
  assert.ok(tooltip?.includes("проверено"));
});

test("tooltip_without_checked_at_does_not_leave_dangling_separator", () => {
  const tooltip = livenessTooltip("dead", null, null, null);
  assert.equal(tooltip, "Страницы нет");
  assert.ok(!tooltip?.includes("—"));
});

test("tooltip_returns_null_for_throttled", () => {
  assert.equal(livenessTooltip("throttled", null, null, 0), null);
});

test("texts_never_contain_http_codes_or_english_network_error_names", () => {
  const statuses: Array<Parameters<typeof livenessText>[0]> = ["dead", "error", "gated", "blocked", "ok", "throttled", null];
  const reasons: Array<Parameters<typeof livenessText>[1]> = ["timeout", "dns", "refused", "tls", "redirects", "other", null];
  for (const status of statuses) {
    for (const reason of reasons) {
      for (const httpStatus of [null, 404, 410, 500, 403]) {
        const text = livenessText(status, reason, httpStatus);
        if (text) {
          assert.ok(!/ERR_|\d{3}/.test(text), `leaked code in "${text}"`);
        }
      }
    }
  }
});
