"use client";

import { useTenant } from "@/lib/hooks";

import { cx } from "./ui";

/**
 * While the AI team is responding to an attack, the whole screen turns light red and its edges
 * glow, so the attack is obvious from any page. Purely visual: it never captures clicks.
 */
export function AttackBackdrop() {
  const responding = useTenant().data?.status === "responding";
  return (
    <>
      <div
        aria-hidden
        className={cx(
          "pointer-events-none fixed inset-0 -z-10 transition-colors duration-700",
          responding ? "bg-rose-100/80" : "bg-transparent",
        )}
      />
      {responding && <div aria-hidden className="pointer-events-none fixed inset-0 z-40 animate-attack-glow" />}
      <span className="sr-only" role="status" aria-live="assertive">
        {responding ? "攻撃を検知しました。AIチームが対応しています。" : ""}
      </span>
    </>
  );
}
