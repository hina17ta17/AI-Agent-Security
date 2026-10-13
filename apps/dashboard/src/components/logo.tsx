import { ShieldCheck } from "lucide-react";

/** `compact`: on phones only the shield is shown, so the app header fits with every menu item. */
export function Logo({ size = "md", compact = false }: { size?: "md" | "lg"; compact?: boolean }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`brand-gradient grid place-items-center rounded-xl text-white shadow-lift ${big ? "size-11" : "size-8"}`}>
        <ShieldCheck size={big ? 24 : 18} strokeWidth={2.2} />
      </span>
      <span className={`text-gradient font-display font-bold tracking-tight ${big ? "text-3xl" : "text-xl"} ${compact ? "hidden sm:inline" : ""}`}>AgentGuard</span>
    </span>
  );
}
