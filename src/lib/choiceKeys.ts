export function choiceByKey<T>(values: readonly T[], current: T, key: string): T | null {
  const index = values.indexOf(current);
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return values[(index + 1) % values.length];
    case "ArrowUp":
    case "ArrowLeft":
      return values[(index - 1 + values.length) % values.length];
    case "Home":
      return values[0];
    case "End":
      return values[values.length - 1];
    default:
      return null;
  }
}
