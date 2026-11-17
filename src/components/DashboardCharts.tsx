import { DailyTrendPoint, OverviewStats } from '../types';

interface DashboardChartsProps {
  stats: OverviewStats;
  dailyTrend: DailyTrendPoint[];
}

export function DashboardCharts({ stats, dailyTrend }: DashboardChartsProps) {
  const total = Math.max(stats.totalRegistrations, 1);
  const confirmedPct = (stats.confirmedAttendees / total) * 100;
  const pendingPct = (stats.pendingConfirmations / total) * 100;
  const declinedPct = (stats.unableToAttend / total) * 100;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const confirmedDash = (confirmedPct / 100) * circumference;
  const pendingDash = (pendingPct / 100) * circumference;
  const declinedDash = (declinedPct / 100) * circumference;

  const pairingEligible = Math.max(stats.eligibleForPairing, 1);
  const pairingCompletionPct =
    stats.eligibleForPairing > 0
      ? Math.round((stats.successfullyPaired / pairingEligible) * 100)
      : 0;

  const giftConsentPct =
    stats.totalRegistrations > 0
      ? Math.round((stats.giftExchangeParticipants / total) * 100)
      : 0;

  const maxTrendCount = Math.max(...dailyTrend.map((d) => d.count), 1);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Chart 1: Attendance Breakdown Donut */}
      <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Attendance Breakdown</h3>
            <p className="text-xs text-slate-400">Live guest RSVP distribution</p>
          </div>
          <span className="font-mono-tabular text-xs text-slate-300">
            {stats.totalRegistrations} total
          </span>
        </div>

        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
          <div className="relative h-36 w-36 shrink-0">
            <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
              <circle
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="16"
              />
              {stats.totalRegistrations > 0 && (
                <>
                  <circle
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke="#16A34A"
                    strokeWidth="16"
                    strokeDasharray={`${confirmedDash} ${circumference}`}
                    strokeDashoffset={0}
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke="#D97706"
                    strokeWidth="16"
                    strokeDasharray={`${pendingDash} ${circumference}`}
                    strokeDashoffset={-confirmedDash}
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke="#DC2626"
                    strokeWidth="16"
                    strokeDasharray={`${declinedDash} ${circumference}`}
                    strokeDashoffset={-(confirmedDash + pendingDash)}
                  />
                </>
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono-tabular text-2xl font-semibold text-white">
                {stats.confirmedAttendees}
              </span>
              <span className="text-[11px] text-slate-400">Confirmed</span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-200">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#16A34A]" />
                Confirmed Attending
              </span>
              <span className="font-mono-tabular font-medium text-white">
                {stats.confirmedAttendees} ({Math.round(confirmedPct)}%)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-200">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#D97706]" />
                Pending Confirmation
              </span>
              <span className="font-mono-tabular font-medium text-white">
                {stats.pendingConfirmations} ({Math.round(pendingPct)}%)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-200">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#DC2626]" />
                Unable to Attend
              </span>
              <span className="font-mono-tabular font-medium text-white">
                {stats.unableToAttend} ({Math.round(declinedPct)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart 2: Pairing Completion & Gift Exchange Participation */}
      <div className="rounded-xl border border-[#E5B84B]/25 bg-[#100C07]/90 p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Gift Participation & Pairing Progress
            </h3>
            <p className="text-xs text-slate-400">
              Consent rate and eligible pairing completion
            </p>
          </div>
          <span className="font-mono-tabular text-xs text-[#E5C158]">
            {stats.lockedPairings} locked
          </span>
        </div>

        {/* Gift Exchange Participation Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">
              Gift Exchange Consent
            </span>
            <span className="font-mono-tabular text-slate-300">
              {stats.giftExchangeParticipants} participating · {stats.optedOutOfGifting} opted out ({giftConsentPct}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10 flex">
            <div
              className="h-full bg-[#D4AF37] transition-all duration-300"
              style={{ width: `${giftConsentPct}%` }}
            />
          </div>
        </div>

        {/* Pairing Completion Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">
              Eligible Pairing Completion
            </span>
            <span className="font-mono-tabular text-slate-300">
              {stats.successfullyPaired} / {stats.eligibleForPairing} paired ({pairingCompletionPct}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10 flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${pairingCompletionPct}%` }}
            />
          </div>
        </div>

        {/* Registration Activity Trend */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">
              Registration Timeline (By Day)
            </span>
            <span className="font-mono-tabular text-slate-400">
              {dailyTrend.length} active day(s)
            </span>
          </div>
          {dailyTrend.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              Registration bars will appear once guests begin registering.
            </p>
          ) : (
            <div className="flex items-end gap-2 h-20 pt-2">
              {dailyTrend.map((point) => {
                const heightPct = Math.max(12, Math.round((point.count / maxTrendCount) * 100));
                return (
                  <div
                    key={point.day}
                    className="flex-1 flex flex-col items-center justify-end gap-1 h-full"
                    title={`${point.day}: ${point.count} registration(s)`}
                  >
                    <span className="font-mono-tabular text-[10px] text-slate-300">
                      {point.count}
                    </span>
                    <div
                      className="w-full max-w-8 rounded-t bg-[#D4AF37]/85 hover:bg-[#E5C158] transition-colors"
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="font-mono-tabular text-[10px] text-slate-400 truncate max-w-full">
                      {point.day.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
