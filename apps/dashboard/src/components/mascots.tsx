// The AgentGuard team as small geometric characters (inline SVG, no image files).
import { cx } from "./ui";

export type Member = "mihari" | "bannin" | "shirabe" | "mamoru" | "tsutae";
export type Mood = "idle" | "active" | "alert" | "happy";

export const TEAM: Record<Member, { name: string; role: string; ai: boolean; color: string; from: string; to: string }> = {
  mihari: { name: "ミハリ", role: "見張り（WAF）", ai: false, color: "#4f46e5", from: "#6366f1", to: "#4338ca" },
  bannin: { name: "番人", role: "AIを守る門番（Model Armor）", ai: false, color: "#06b6d4", from: "#22d3ee", to: "#0891b2" },
  shirabe: { name: "シラベ", role: "解析（AI）", ai: true, color: "#f59e0b", from: "#fbbf24", to: "#d97706" },
  mamoru: { name: "マモル", role: "防御（AI）", ai: true, color: "#10b981", from: "#34d399", to: "#059669" },
  tsutae: { name: "ツタエ", role: "報告（AI）", ai: true, color: "#ec4899", from: "#f472b6", to: "#db2777" },
};

function Face({ mood, cx: x = 32, cy = 34 }: { mood: Mood; cx?: number; cy?: number }) {
  const eyeY = cy - 3;
  const eyes =
    mood === "happy" ? (
      <g stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round">
        <path d={`M${x - 11} ${eyeY + 1} q4 -5 8 0`} />
        <path d={`M${x + 3} ${eyeY + 1} q4 -5 8 0`} />
      </g>
    ) : (
      <g>
        {[x - 7, x + 7].map((ex) => (
          <g key={ex}>
            <circle cx={ex} cy={eyeY} r={mood === "alert" ? 6 : 5} fill="#fff" />
            <circle cx={ex + (mood === "active" ? 1.2 : 0)} cy={eyeY + (mood === "active" ? 0.8 : 0)} r={mood === "alert" ? 2.6 : 2.3} fill="#0f172a" />
            <circle cx={ex + 1.4} cy={eyeY - 1.6} r="0.9" fill="#fff" />
          </g>
        ))}
        {mood === "active" && (
          <g stroke="#0f172a" strokeWidth="2" strokeLinecap="round">
            <path d={`M${x - 12} ${eyeY - 7} l7 2`} />
            <path d={`M${x + 12} ${eyeY - 7} l-7 2`} />
          </g>
        )}
      </g>
    );
  const mouth =
    mood === "alert" ? (
      <ellipse cx={x} cy={cy + 8} rx="3" ry="3.4" fill="#0f172a" />
    ) : mood === "active" ? (
      <path d={`M${x - 4} ${cy + 8} h8`} stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />
    ) : (
      <path d={`M${x - 5} ${cy + 6} q5 5 10 0`} stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    );
  return (
    <g>
      {eyes}
      {mouth}
      <circle cx={x - 13} cy={cy + 5} r="2.6" fill="#fff" opacity="0.35" />
      <circle cx={x + 13} cy={cy + 5} r="2.6" fill="#fff" opacity="0.35" />
    </g>
  );
}

function Body({ member, id }: { member: Member; id: string }) {
  const fill = `url(#${id})`;
  switch (member) {
    case "mihari": // watchful owl
      return (
        <g>
          <path d="M14 18 L20 6 L26 16 Z M50 18 L44 6 L38 16 Z" fill={fill} />
          <circle cx="32" cy="34" r="22" fill={fill} />
        </g>
      );
    case "bannin": // shield gatekeeper
      return <path d="M32 6 L54 14 V32 C54 46 44 55 32 59 C20 55 10 46 10 32 V14 Z" fill={fill} />;
    case "shirabe": // analyst with round glasses
      return (
        <g>
          <rect x="10" y="12" width="44" height="44" rx="16" fill={fill} />
          <g fill="none" stroke="#0f172a" strokeWidth="2">
            <circle cx="25" cy="31" r="8" />
            <circle cx="39" cy="31" r="8" />
            <path d="M33 31 h-2" />
          </g>
        </g>
      );
    case "mamoru": // defender with a helmet band and badge
      return (
        <g>
          <rect x="10" y="12" width="44" height="44" rx="20" fill={fill} />
          <rect x="10" y="14" width="44" height="8" rx="4" fill="#0f172a" opacity="0.18" />
          <path d="M46 40 l6 2 v5 c0 4 -3 6 -6 7 c-3 -1 -6 -3 -6 -7 v-5 z" fill="#fff" opacity="0.9" />
        </g>
      );
    case "tsutae": // reporter shaped like a speech bubble
      return <path d="M16 10 H48 a8 8 0 0 1 8 8 V42 a8 8 0 0 1 -8 8 H30 L20 58 V50 H16 a8 8 0 0 1 -8 -8 V18 a8 8 0 0 1 8 -8 Z" fill={fill} />;
  }
}

export function Mascot({ member, mood = "idle", size = 56, className }: { member: Member; mood?: Mood; size?: number; className?: string }) {
  const t = TEAM[member];
  const id = `grad-${member}`;
  const faceY = member === "tsutae" ? 30 : member === "bannin" ? 32 : member === "shirabe" ? 35 : 34;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={t.name} className={cx(mood === "active" && "animate-float", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.from} />
          <stop offset="1" stopColor={t.to} />
        </linearGradient>
      </defs>
      <Body member={member} id={id} />
      <Face mood={mood} cy={faceY} />

    </svg>
  );
}
