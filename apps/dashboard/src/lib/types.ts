// Shapes of the Firestore documents written by the agent / target / dashboard services.
import type { Timestamp } from "firebase/firestore";

export type TenantStatus = "safe" | "responding" | "awaiting_approval";

export type Tenant = {
  siteId: string;
  siteMode: "normal" | "maintenance";
  maintenanceUntil?: Timestamp;
  aiMode: "demo" | "byok";
  keyStatus: "none" | "valid" | "invalid";
  keyHint: string | null;
  status?: TenantStatus;
  statusAt?: Timestamp;
  /** AI investigations running now: incidentId -> start time (written only by the agent). */
  active?: Record<string, Timestamp>;
  /** The most recently started investigation (the dashboard follows it unless a tab is pinned). */
  activeIncidentId?: string;
  /** The latest attack wave (many attacks at once). */
  campaignId?: string;
  lastAttackerIp?: string;
  settings?: { allowlist?: string[] };
};

/** An attack wave: beyond the concurrent-AI cap, events are blocked at once by rule. */
export type Campaign = {
  id: string;
  openedAt?: Timestamp;
  lastEventAt?: Timestamp;
  /** Events handled by rule (no AI call), including refused ones. */
  events?: number;
  ruleBlocks?: number;
  /** Rule blocks lengthened to an AI decision made during the wave. */
  extendedBlocks?: number;
  /** Seconds from the WAF detection to the rule block (sum / count / max over timed blocks). */
  blockSecTotal?: number;
  timedBlocks?: number;
  blockSecMax?: number;
  byType?: Record<string, number>;
  ips?: string[];
  /** Incidents the AI investigated in full while the wave was going on. */
  analyzedIncidents?: string[];
  aiDecisions?: Record<string, { minutes: number; severity: Verdict["severity"]; incidentId: string }>;
};

export type Verdict = {
  attack_type: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  targets_ai: boolean;
  recommended_action: "block" | "watch" | "isolate" | "none";
  narration_ja: string;
  evidence: string[];
};

export type Action = {
  type: "block_ip" | "watch_ip";
  ip: string;
  minutes?: number;
  requestedMinutes?: number;
  until?: string;
  reasonJa: string;
  by: string;
};

export type Incident = {
  id: string;
  status: "analyzing" | "resolved" | "awaiting_approval" | "fallback";
  mode?: "demo" | "byok";
  route?: "DEFEND" | "WATCH" | "DISMISS" | null;
  relatedEvents?: number;
  attack: {
    ruleId: string;
    type: string;
    labelJa: string;
    method: string;
    path: string;
    field: string;
    srcIp: string;
    simulated: boolean;
    payloadPreview: string;
  };
  guard?: {
    screened: boolean;
    promptInjection: boolean;
    piConfidence: string;
    maliciousUri: boolean;
    payloadWithheld: boolean;
  } | null;
  verdict?: Verdict | null;
  actions?: Action[];
  approvals?: { id: string; action: string; minutes: number }[];
  approvalDecision?: "approve" | "reject";
  /** Set when this investigation guided an attack wave. */
  campaignId?: string;
  report?: { markdown: string };
  failure?: string | null;
  usage?: { inputTokens: number; outputTokens: number; byModel?: Record<string, { inputTokens: number; outputTokens: number }> };
  estCostUsd?: number;
  traceId?: string | null;
  traceUrl?: string | null;
  timings?: {
    receivedAt?: Timestamp;
    wafRuleMs?: number;
    pushReceivedAt?: Timestamp;
    aiStartedAt?: Timestamp;
    guardAt?: Timestamp;
    verdictAt?: Timestamp;
    actionAt?: Timestamp;
    reportAt?: Timestamp;
    resolvedAt?: Timestamp;
    aiActionSec?: number | null;
    totalSec?: number;
  };
  createdAt?: Timestamp;
};

export type StepAgent = "mihari" | "bannin" | "shirabe" | "mamoru" | "tsutae" | "system";

export type Step = {
  id: string;
  seq: number;
  agent: StepAgent;
  kind: string;
  text: string;
  extra?: Record<string, unknown>;
  at?: Timestamp;
};

export type BlockEntry = {
  id: string;
  ip: string;
  reasonJa: string;
  incidentId?: string;
  blockedBy: string;
  minutes?: number;
  hits?: number;
  expiresAt?: Timestamp;
};

export type Approval = {
  id: string;
  action: "isolate_site";
  minutes: number;
  reasonJa: string;
  incidentId: string;
  requestedBy: string;
  status: "pending" | "approved" | "rejected";
  createdAt?: Timestamp;
};

export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  incidentId?: string | null;
  at?: Timestamp;
};

export type Usage = { aiRuns: number; limit: number; mode: string };
