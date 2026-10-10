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
  activeIncidentId?: string;
  lastAttackerIp?: string;
  settings?: { allowlist?: string[] };
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
