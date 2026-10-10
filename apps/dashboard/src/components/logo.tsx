import { ShieldCheck } from "lucide-react";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`brand-gradient grid place-items-center rounded-xl text-white shadow-lift ${big ? "size-11" : "size-8"}`}>
        <ShieldCheck size={big ? 24 : 18} strokeWidth={2.2} />
      </span>
      <span className={`text-gradient font-display font-bold tracking-tight ${big ? "text-3xl" : "text-xl"}`}>AgentGuard</span>
    </span>
  );
}
