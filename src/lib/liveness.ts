import { shortRu } from "./dates.ts";
import type { LinkReason, LinkStatus } from "./types.ts";

export type LivenessClass = "dead" | "warn" | null;

const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;

export function livenessClass(bookmark: { linkStatus: LinkStatus | null }): LivenessClass {
  if (bookmark.linkStatus === "dead") return "dead";
  if (bookmark.linkStatus === "error") return "warn";
  return null;
}

function errorText(reason: LinkReason | null, httpStatus: number | null): string {
  if (httpStatus === HTTP_NOT_FOUND || httpStatus === HTTP_GONE) return "Страницы нет";
  if (reason === "timeout") return "Сайт не отвечает";
  if (reason === "dns") return "Домен не найден";
  if (reason === "tls") return "Проблема с сертификатом";
  return "Сайт недоступен";
}

export function livenessText(
  status: LinkStatus | null,
  reason: LinkReason | null,
  httpStatus: number | null,
): string | null {
  if (status === null) return "Ещё не проверялось";
  if (status === "dead") return "Страницы нет";
  if (status === "ok") return "Открывается нормально";
  if (status === "gated" || status === "blocked") return "Недоступно для Trove";
  if (status === "throttled") return null;
  return errorText(reason, httpStatus);
}

export function livenessTooltip(
  status: LinkStatus | null,
  reason: LinkReason | null,
  httpStatus: number | null,
  checkedAt: number | null,
): string | null {
  const base = status === "dead" ? "Страница не найдена" : livenessText(status, reason, httpStatus);
  if (!base) return null;
  if (checkedAt === null) return base;
  return `${base} — проверено ${shortRu(checkedAt)}`;
}
