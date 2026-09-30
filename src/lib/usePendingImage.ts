import { useEffect, useRef } from "react";
import type { ImagePick } from "./imageSource";

export function usePendingImage(
  pick: ImagePick | undefined,
  onFile: (file: File) => Promise<void>,
  onUrl: (url: string) => Promise<void>,
) {
  const taken = useRef(false);
  const handlers = useRef({ onFile, onUrl });
  handlers.current = { onFile, onUrl };

  useEffect(() => {
    if (!pick || taken.current) return;
    taken.current = true;
    if (pick.kind === "file") void handlers.current.onFile(pick.file);
    else void handlers.current.onUrl(pick.url);
  }, [pick]);
}
