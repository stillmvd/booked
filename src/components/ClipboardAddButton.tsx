import { useEffect, useRef, useState } from "react";

import { clipboardUrl } from "../lib/api";
import { NO_LINK_HINT } from "../lib/clipboard";
import { Icon } from "./Icon";

const LABEL = "Добавить из буфера";

interface ClipboardAddButtonProps {
  className: string;
  onAdd: (url: string) => void;
  onNoLink: (hint: string) => void;
}

const HOVER_DELAY_MS = 150;

export function ClipboardAddButton({ className, onAdd, onNoLink }: ClipboardAddButtonProps) {
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

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      clipboardUrl().then((result) => {
        if (cancelled) return;
        setPreview(result.url);
        setChecked(true);
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      cancelPending();
    };
  }, []);

  async function handleClick() {
    const result = await clipboardUrl();
    setPreview(result.url);
    setChecked(true);
    if (result.url) onAdd(result.url);
    else onNoLink(NO_LINK_HINT);
  }

  const disabled = checked && !preview;

  return (
    <button
      type="button"
      className={`${className} clipboard-add-button`}
      aria-label={LABEL}
      aria-disabled={disabled}
      title={disabled ? NO_LINK_HINT : preview ? `${LABEL}: ${preview}` : LABEL}
      onMouseEnter={check}
      onMouseLeave={cancelPending}
      onFocus={check}
      onBlur={cancelPending}
      onClick={handleClick}
    >
      <Icon name="clipboard" />
    </button>
  );
}
