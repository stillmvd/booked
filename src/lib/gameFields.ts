const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export const RATE_REMIND_SECS = 300;
export const PLAY_CHIP_SECS = 60;

export function playTime(secs: number): string {
  const minutes = Math.floor(Math.max(0, secs) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} мин`;
  if (hours >= 10 || rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

export function playTimeFull(secs: number): string {
  const minutes = Math.floor(Math.max(0, secs) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

export function finishedLabel(ms: number, now: number = Date.now()): string {
  const date = new Date(ms);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

export function wantsRating(game: { rating: number; status: string; playSecs: number }): boolean {
  return game.rating === 0 && (game.status === "playing" || game.status === "finished") && game.playSecs >= RATE_REMIND_SECS;
}
