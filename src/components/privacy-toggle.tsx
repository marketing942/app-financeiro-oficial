"use client";

import { useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

// Botão de privacidade: borra todos os valores monetários da tela
// (CSS em globals.css). Preferência mantida no dispositivo.

const EVENT = "privacy-change";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): boolean {
  const on = localStorage.getItem("privacy-mode") === "on";
  document.documentElement.dataset.privacy = on ? "on" : "off";
  return on;
}

export function PrivacyToggle() {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    localStorage.setItem("privacy-mode", hidden ? "off" : "on");
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
    >
      {hidden ? <EyeOff /> : <Eye />}
      {hidden ? "Valores ocultos" : "Ocultar valores"}
    </Button>
  );
}
