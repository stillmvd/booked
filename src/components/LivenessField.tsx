import { useState } from "react";

import { livenessCheck } from "../lib/api";
import { livenessText } from "../lib/liveness";
import { shortRu } from "../lib/dates";
import type { LinkReason, LinkStatus, LivenessItem } from "../lib/types";

const GATED_HINT =
  "Сайт блокирует автоматическую проверку — в вашем браузере, скорее всего, откроется нормально";

interface LivenessFieldProps {
  bookmarkId: number;
  linkStatus: LinkStatus | null;
  linkReason: LinkReason | null;
  httpStatus: number | null;
  lastCheckedAt: number | null;
  onChecked: (item: LivenessItem) => void;
}

function severityClass(status: LinkStatus | null): string {
  if (status === "ok") return "liveness-field-status-ok";
  if (status === "dead") return "liveness-field-status-dead";
  if (status === "gated" || status === "blocked") return "liveness-field-status-gated";
  if (status === "error") return "liveness-field-status-warn";
  return "";
}

export function LivenessField({
  bookmarkId,
  linkStatus,
  linkReason,
  httpStatus,
  lastCheckedAt,
  onChecked,
}: LivenessFieldProps) {
  const [checking, setChecking] = useState(false);

  const text = livenessText(linkStatus, linkReason, httpStatus) ?? "";
  const showDate = linkStatus !== null && lastCheckedAt !== null;
  const showHint = linkStatus === "gated" || linkStatus === "blocked";

  function handleCheck() {
    setChecking(true);
    livenessCheck(bookmarkId)
      .then(onChecked)
      .catch((err) => console.error(err))
      .finally(() => setChecking(false));
  }

  return (
    <div className="field liveness-field">
      <span className="field-label">Состояние ссылки</span>
      <p className={`liveness-field-status ${severityClass(linkStatus)}`} aria-live="polite">
        {text}
        {showDate ? (
          <>
            {" · "}
            <span className="liveness-field-date">проверено {shortRu(lastCheckedAt as number)}</span>
          </>
        ) : null}
      </p>
      {showHint ? <p className="liveness-field-hint">{GATED_HINT}</p> : null}
      <button type="button" className="link-button" onClick={handleCheck} disabled={checking}>
        {checking ? "Проверяем…" : linkStatus === null ? "Проверить сейчас" : "Проверить снова"}
      </button>
    </div>
  );
}
