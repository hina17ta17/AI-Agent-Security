import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Tone = "brand" | "safe" | "warn" | "danger" | "muted";

const TONE_BADGE: Record<Tone, string> = {
  brand: "bg-brand/10 text-brand",
  safe: "bg-safe/12 text-emerald-700",
  warn: "bg-warn/15 text-amber-700",
  danger: "bg-danger/12 text-rose-700",
  muted: "bg-slate-100 text-muted",
};

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-card border border-line bg-card shadow-soft", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, icon, right, sub }: { title: string; icon?: ReactNode; right?: ReactNode; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
          {icon}
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Badge({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE_BADGE[tone], className)}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "soft";
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const styles = {
    primary: "brand-gradient text-white shadow-lift hover:brightness-110",
    soft: "bg-brand/8 text-brand hover:bg-brand/14",
    ghost: "bg-white text-ink border border-line hover:bg-slate-50",
    danger: "bg-danger text-white hover:brightness-110",
  }[variant];
  const sizes = size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        sizes,
        className,
      )}
    />
  );
}

export function Stat({ label, value, unit, hint, tone = "brand" }: { label: string; value: string; unit?: string; hint?: string; tone?: Tone }) {
  const color = { brand: "text-brand", safe: "text-emerald-600", warn: "text-amber-600", danger: "text-rose-600", muted: "text-ink" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cx("font-mono text-2xl font-bold tabular-nums", color)}>{value}</span>
        {unit && <span className="text-sm font-semibold text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 text-center text-sm text-muted">{children}</div>;
}
