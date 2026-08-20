export type ThumbState = "preview" | "pending" | "plate";

export function thumbState(input: { image: string | null; previewPending?: boolean }): ThumbState {
  if (input.image) return "preview";
  if (input.previewPending) return "pending";
  return "plate";
}
