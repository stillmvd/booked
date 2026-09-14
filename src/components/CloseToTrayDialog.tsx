import { useState } from "react";

import { settingsWrite } from "../lib/api";
import { DialogHead, DialogPocket, SubmitMark } from "./DialogHead";

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

  return (
    <form
      className="close-to-tray-dialog dialog"
      onSubmit={(e) => {
        e.preventDefault();
        commit("tray");
      }}
    >
      <DialogHead id={titleId} title="Свернуть Booked в трей?" onClose={onClose} />

      <div className="dialog-body">
        <DialogPocket className="dialog-note">
          <p>Приложение останется работать в фоне — открыть его снова можно из значка в трее или тем же хоткеем.</p>

          <label className="close-to-tray-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Больше не спрашивать
          </label>
        </DialogPocket>
      </div>

      <div className="form-actions">
        <button type="button" onClick={() => commit("quit")}>
          Выйти
        </button>
        <button type="submit">
          Свернуть в трей
          <SubmitMark />
        </button>
      </div>
    </form>
  );
}
