import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-mauve text-crust hover:bg-lavender",
  ghost: "bg-surface0 text-subtext1 hover:bg-surface1 hover:text-text",
  danger: "bg-transparent text-overlay1 hover:bg-surface0 hover:text-red",
};

export function Button({
  variant = "ghost",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-surface1 bg-surface0/60 ${className}`}>{children}</div>
  );
}

export function Chip({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const base =
    "rounded-full px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap";
  const tone = active
    ? "bg-mauve/20 text-mauve ring-1 ring-mauve/40"
    : "bg-surface1/60 text-subtext0 hover:text-text";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} ${tone}`}>
      {children}
    </button>
  ) : (
    <span className={`${base} ${tone}`}>{children}</span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-overlay1">
      <span className="size-3 animate-spin rounded-full border-2 border-surface2 border-t-mauve" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-surface1 px-6 py-12 text-center">
      <p className="text-sm text-subtext0">{title}</p>
      {hint && <p className="mt-1 text-xs text-overlay0">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red" role="alert">
      {message}
    </p>
  );
}
