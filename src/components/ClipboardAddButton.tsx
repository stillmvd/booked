import { useEffect, useRef, useState } from "react";

import { clipboardUrl } from "../lib/api";

interface ClipboardAddButtonProps {
  className: string;
  onAdd: (url: string) => void;
}

const HOVER_DELAY_MS = 150;
const NO_LINK_TITLE = "В буфере нет ссылки";

function shortLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${host}${path}`;
  } catch {
    return url;
  }
}

export function ClipboardAddButton({ className, onAdd }: ClipboardAddButtonProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelPending() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function check() {
    cancelPending();
    timerRef.current = setTimeout(() => {
      clipboardUrl().then((result) => {
        setPreview(result.url);
        setChecked(true);
      });
    }, HOVER_DELAY_MS);
  }

  useEffect(() => cancelPending, []);

  async function handleClick() {
    const result = await clipboardUrl();
    if (result.url) onAdd(result.url);
  }

  const disabled = checked && !preview;

  return (
    <button
      type="button"
      className={`${className} clipboard-add-button`}
      disabled={disabled}
      title={disabled ? NO_LINK_TITLE : undefined}
      onMouseEnter={check}
      onMouseLeave={cancelPending}
      onFocus={check}
      onBlur={cancelPending}
      onClick={handleClick}
    >
      {preview ? `Добавить ${shortLabel(preview)}` : "Добавить из буфера"}
    </button>
  );
}
