"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { initials, nameHue } from "@/lib/format";
import { X } from "@/components/icons";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/* ---------------- Buttons ---------------- */

type BtnVariant = "primary" | "ghost" | "outline" | "danger" | "subtle";

export function Button({
  variant = "primary",
  className,
  loading,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  loading?: boolean;
}) {
  const styles: Record<BtnVariant, string> = {
    primary:
      "bg-accent-600 hover:bg-accent-500 text-white shadow-[0_1px_0_rgb(255_255_255/0.1)_inset,0_8px_24px_-12px_rgb(99_102_241/0.8)]",
    ghost: "bg-transparent hover:bg-ink-700 text-mist-300 hover:text-mist-100",
    subtle: "bg-ink-700 hover:bg-ink-600 text-mist-100 border border-line",
    outline:
      "bg-transparent border border-line-strong hover:border-accent-500/60 hover:bg-accent-500/10 text-mist-100",
    danger: "bg-danger/15 hover:bg-danger/25 text-danger border border-danger/25",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none",
        styles[variant],
        className
      )}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function IconButton({
  className,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-mist-500 transition-colors hover:bg-ink-600 hover:text-mist-100",
        className
      )}
    />
  );
}

/* ---------------- Inputs ---------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-mist-300">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-mist-600">{hint}</span>}
    </label>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        "w-full rounded-lg border border-line bg-ink-800 px-3 py-2 text-sm text-mist-100 placeholder:text-mist-600 transition-colors focus:border-accent-500/70 focus:bg-ink-750",
        className
      )}
    />
  );
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx(
        "w-full resize-none rounded-lg border border-line bg-ink-800 px-3 py-2 text-sm text-mist-100 placeholder:text-mist-600 transition-colors focus:border-accent-500/70 focus:bg-ink-750",
        className
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        "w-full appearance-none rounded-lg border border-line bg-ink-800 px-3 py-2 text-sm text-mist-100 transition-colors focus:border-accent-500/70",
        className
      )}
    >
      {children}
    </select>
  );
}

/* ---------------- Avatar ---------------- */

export function Avatar({
  name,
  src,
  size = 32,
  square,
  online,
}: {
  name: string;
  src?: string | null;
  size?: number;
  square?: boolean;
  online?: boolean;
}) {
  const hue = nameHue(name || "?");
  return (
    <span
      className="relative inline-flex shrink-0 select-none"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={cx(
            "h-full w-full object-cover",
            square ? "rounded-lg" : "rounded-full"
          )}
        />
      ) : (
        <span
          className={cx(
            "flex h-full w-full items-center justify-center font-semibold text-white",
            square ? "rounded-lg" : "rounded-full"
          )}
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 30%))`,
            fontSize: Math.max(10, size * 0.38),
          }}
        >
          {initials(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={cx(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-ink-850",
            online ? "bg-ok" : "bg-mist-600"
          )}
          style={{ width: size * 0.32, height: size * 0.32 }}
        />
      )}
    </span>
  );
}

/* ---------------- Badge / Spinner ---------------- */

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        className || "border-line-strong text-mist-300"
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-mist-600/40 border-t-mist-100"
      style={{ width: size, height: size }}
    />
  );
}

export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-ink-950">
      <Spinner size={22} />
      {label && <p className="text-sm text-mist-500">{label}</p>}
    </div>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="animate-pop w-full rounded-xl border border-line bg-ink-850 shadow-2xl shadow-black/50"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-semibold text-mist-100">{title}</h3>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ---------------- Toasts ---------------- */

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "error") => void>(
  () => {}
);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "animate-fade-up rounded-lg border px-4 py-2 text-sm shadow-xl shadow-black/40 backdrop-blur",
              t.tone === "ok"
                ? "border-line bg-ink-750/95 text-mist-100"
                : "border-danger/30 bg-danger/15 text-danger"
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Misc ---------------- */

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-4">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-600">
        {children}
      </span>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-mist-600">{icon}</div>}
      <p className="text-sm font-medium text-mist-300">{title}</p>
      {hint && <p className="max-w-[300px] text-[13px] text-mist-600">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
