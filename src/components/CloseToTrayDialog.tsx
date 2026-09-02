import { useState } from "react";

import { settingsWrite } from "../lib/api";

interface CloseToTrayDialogProps {
  onTray: () => void;
  onQuit: () => void;
}

export function CloseToTrayDialog({ onTray, onQuit }: CloseToTrayDialogProps) {
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
      className="close-to-tray-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        commit("tray");
      }}
    >
      <p>Свернуть Trove в трей?</p>
      <p>Приложение останется работать в фоне — открыть его снова можно из значка в трее или тем же хоткеем.</p>

      <label className="close-to-tray-remember">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Больше не спрашивать
      </label>

      <div className="form-actions">
        <button type="button" onClick={() => commit("quit")}>
          Выйти
        </button>
        <button type="submit">Свернуть в трей</button>
      </div>
    </form>
  );
}
