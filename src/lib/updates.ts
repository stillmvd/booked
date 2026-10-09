export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} МБ`;
}

export function formatProgress(downloaded: number, total: number | null): string {
  if (total === null || total <= 0) return formatBytes(downloaded);
  return `${formatBytes(downloaded)} из ${formatBytes(total)}`;
}

export function checkedAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Проверено только что";
  if (minutes < 60) return `Проверено ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Проверено ${hours} ч назад`;
  return `Проверено ${Math.floor(hours / 24)} дн назад`;
}

export function describeUpdateError(err: unknown): string {
  const text = String(err instanceof Error ? err.message : err).toLowerCase();
  if (/1223|cancel|отмен/.test(text)) return "Установка отменена: Windows не получила права администратора";
  if (/signature|подпис|minisign|verif|base64|decod|encod|public key|pubkey/.test(text)) {
    return "Подпись обновления не совпала, файл не принят";
  }
  if (/network|dns|connect|timed out|timeout|resolve|sending request|os error/.test(text)) {
    return "Нет сети или сайт с обновлениями недоступен";
  }
  if (/404|not found/.test(text)) return "На сайте пока нет списка версий";
  return "Не удалось обновиться";
}
