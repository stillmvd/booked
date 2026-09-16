export function settingsLabel(updateVersion: string | null | undefined): string {
  const version = updateVersion?.trim();
  return version ? `Настройки, доступна версия ${version}` : "Настройки";
}

export function settingsHint(updateVersion: string | null | undefined): string | undefined {
  const version = updateVersion?.trim();
  return version ? `Доступна версия ${version}` : undefined;
}

export function updateMark(updateVersion: string | null | undefined): string | undefined {
  return updateVersion?.trim() || undefined;
}

export function maximizeLabel(maximized: boolean): string {
  return maximized ? "Восстановить окно" : "Развернуть окно";
}
