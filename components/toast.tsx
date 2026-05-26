"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons";

type Severity = "info" | "success" | "error";

type Toast = {
  id: number;
  severity: Severity;
  message: string;
};

type Ctx = {
  push: (severity: Severity, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const push = useCallback((severity: Severity, message: string) => {
    const id = ++idRef.current;
    setToasts((m) => [...m, { id, severity, message }]);
    window.setTimeout(() => {
      setToasts((m) => m.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((m) => m.filter((t) => t.id !== id));
  }, []);

  const api: Ctx = {
    push,
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed z-[60] bottom-4 right-4 flex flex-col gap-2 max-w-[min(360px,calc(100vw-2rem))]">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="relative rounded-xl border bg-zinc-950/95 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]
                           overflow-hidden animate-[toast-in_160ms_ease-out]"
                style={{ borderColor: borderColorFor(t.severity) }}
              >
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{ background: accentFor(t.severity) }}
                />
                <div className="flex items-start gap-3 pl-4 pr-2 py-3">
                  <span
                    className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: dotFor(t.severity) }}
                  />
                  <p className="flex-1 text-xs leading-relaxed text-zinc-200">
                    {t.message}
                  </p>
                  <button
                    onClick={() => dismiss(t.id)}
                    className="text-zinc-500 hover:text-zinc-200 transition-colors -mt-0.5"
                    aria-label="Dismiss"
                  >
                    <CloseIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}

function borderColorFor(s: Severity): string {
  return s === "error"
    ? "rgba(239,68,68,0.35)"
    : s === "success"
      ? "rgba(34,197,94,0.30)"
      : "var(--border)";
}

function accentFor(s: Severity): string {
  return s === "error"
    ? "linear-gradient(to right, transparent, rgba(239,68,68,0.7), transparent)"
    : s === "success"
      ? "linear-gradient(to right, transparent, rgba(34,197,94,0.7), transparent)"
      : "linear-gradient(to right, transparent, rgba(96,165,250,0.7), transparent)";
}

function dotFor(s: Severity): string {
  return s === "error"
    ? "#ef4444"
    : s === "success"
      ? "#22c55e"
      : "var(--accent)";
}
