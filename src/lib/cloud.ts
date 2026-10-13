import type { CloudStatus } from "./types";

export const CLOUD_STATUS_EVENT = "cloud:status";

export function cloudStateText(status: CloudStatus): string {
  const waiting = status.pending > 0 ? `Ждут отправки: ${status.pending}` : null;
  switch (status.state) {
    case "off":
      return "Облако не подключено";
    case "badKey":
      return "Неверный ключ";
    case "offline":
      return waiting ? `Нет связи · ${waiting.toLowerCase()}` : "Нет связи";
    default:
      return waiting ?? "Подключено";
  }
}

export function maskedKey(tail: string | null): string {
  return tail ? `••••${tail}` : "";
}
