"use client";

import { useEffect, useRef } from "react";

import { ApprovalBanner } from "@/components/approval-banner";
import { AttackSimulator } from "@/components/attack-simulator";
import { BlocklistCard } from "@/components/blocklist-card";
import { IncidentList } from "@/components/incident-list";
import { LiveFeed } from "@/components/live-feed";
import { Metrics } from "@/components/metrics";
import { ReportCard } from "@/components/report";
import { StatusHero } from "@/components/status-hero";
import { moodsFor, TeamPanel } from "@/components/team-panel";
import { useSession } from "@/lib/auth-context";
import { useBlocklist, useIncident, useIncidents, usePendingApprovals, useSteps, useTenant, useUsageToday } from "@/lib/hooks";
import { chime } from "@/lib/sound";

export default function DashboardPage() {
  const { siteUrl } = useSession();
  const tenant = useTenant().data;
  const incidents = useIncidents(20).data;
  const focusId = tenant?.activeIncidentId ?? incidents[0]?.id ?? null;
  const incident = useIncident(focusId).data;
  const steps = useSteps(focusId).data;
  const blocklist = useBlocklist().data;
  const approvals = usePendingApprovals().data;
  const usage = useUsageToday();
  const live = tenant?.status === "responding";

  // Sound cues on status transitions (not on first load).
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const now = tenant?.status;
    if (previous.current && now && previous.current !== now) {
      if (now === "responding") chime("alert");
      else if (previous.current === "responding") chime("resolved");
    }
    previous.current = now;
  }, [tenant?.status]);

  return (
    <div className="space-y-5">
      <ApprovalBanner approvals={approvals} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <StatusHero tenant={tenant} incident={incident} siteUrl={siteUrl} />
          <TeamPanel moods={moodsFor(incident, steps, live)} />
          <LiveFeed incident={incident} steps={steps} live={live} />
          {incident && <ReportCard markdown={incident.report?.markdown} pending={incident.status === "analyzing"} />}
        </div>
        <div className="space-y-5">
          <AttackSimulator />
          <Metrics latest={incidents[0] ?? null} incidents={incidents} blocklist={blocklist} usage={usage} aiMode={tenant?.aiMode} />
          <BlocklistCard entries={blocklist} />
        </div>
      </div>
      <IncidentList incidents={incidents} />
    </div>
  );
}
