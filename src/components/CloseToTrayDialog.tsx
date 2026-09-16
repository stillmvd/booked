import { useState } from "react";
import type { KeyboardEvent } from "react";

import { settingsWrite } from "../lib/api";
import { DialogHead } from "./DialogHead";
import { Icon } from "./Icon";

interface CloseToTrayDialogProps {
  titleId?: string;
  onTray: () => void;
  onQuit: () => void;
  onClose: () => void;
}

export function CloseToTrayDialog({ titleId, onTray, onQuit, onClose }: CloseToTrayDialogProps) {
  const [remember, setRemember] = useState(false);

  async function commit(action: "tray" | "quit") {
    if (remember) {
      try {
        await settingsWrite("close_action", action);
      } catch (err) {
        console.error(err);
      }
    }
    if (action === "tray") onTray();
    else onQuit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest(".tray-action, .form-actions, .dialog-close")) return;
    e.preventDefault();
    void commit("tray");
  }

  return (
    <div className="close-to-tray-dialog dialog" onKeyDown={handleKeyDown}>
      <DialogHead id={titleId} title="Свернуть Booked в трей?" onClose={onClose} />

      <div className="dialog-body">
        <div className="tray-actions">
          <button type="button" className="tray-action tray-action-main" autoFocus onClick={() => void commit("tray")}>
            <span className="tray-action-top">
              <span className="tray-action-icon" aria-hidden="true">
                <Icon name="tray" />
              </span>
              <span className="tray-action-key" aria-hidden="true">
                Enter
              </span>
            </span>
            <span className="tray-action-text">
              <span className="tray-action-title">В трей</span>
              <span className="tray-action-desc">Окно спрячется, Booked останется в фоне</span>
            </span>
          </button>
          <button type="button" className="tray-action" onClick={() => void commit("quit")}>
            <span className="tray-action-top">
              <span className="tray-action-icon" aria-hidden="true">
                <Icon name="power" />
              </span>
            </span>
            <span className="tray-action-text">
              <span className="tray-action-title">Выйти</span>
              <span className="tray-action-desc">Booked закроется до следующего запуска</span>
            </span>
          </button>
        </div>

        <button
          type="button"
          role="checkbox"
          aria-checked={remember}
          className="tray-remember"
          onClick={() => setRemember((value) => !value)}
        >
          <span className="tray-remember-mark" aria-hidden="true">
            <Icon name="check" />
          </span>
          Больше не спрашивать
        </button>
      </div>

      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
