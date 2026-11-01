// The light game layer on the Drive tab: a day streak and a daily goal.
// Kept small on purpose (founder, 2026-10-27): it must never cover the map.
// Everything here is computed from the driver's own completed rides; nothing
// is invented, and an empty history shows as "start a streak", not zero-shame.

// Trinidad is UTC-4 all year (no daylight saving).
const TT_OFFSET_MS = 4 * 3_600_000;

export function ttDay(iso: string | Date): string {
    const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
    return new Date(t - TT_OFFSET_MS).toISOString().slice(0, 10);
}

function prevDay(day: string): string {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// Days in a row with at least one completed trip, ending today. If there is
// no trip yet today the streak is still alive from yesterday (the driver has
// until midnight), and `todayDone` says whether today already counts.
export function computeStreak(completedAt: string[], now: Date = new Date()): { days: number; todayDone: boolean } {
    const days = new Set(completedAt.filter(Boolean).map((c) => ttDay(c)));
    const today = ttDay(now);
    const todayDone = days.has(today);
    let cursor = todayDone ? today : prevDay(today);
    let n = 0;
    while (days.has(cursor)) {
        n += 1;
        cursor = prevDay(cursor);
    }
    return { days: n, todayDone };
}

export const GOAL_CHOICES_CENTS = [20000, 30000, 50000, 80000] as const;
export const DEFAULT_GOAL_CENTS = 30000;

export function goalProgress(earnedCents: number, goalCents: number): { ratio: number; leftCents: number; reached: boolean } {
    const goal = Math.max(1, goalCents);
    const earned = Math.max(0, earnedCents);
    return { ratio: Math.min(1, earned / goal), leftCents: Math.max(0, goal - earned), reached: earned >= goal };
}

// One short line under the goal bar, in plain words.
export function goalLine(earnedCents: number, goalCents: number): string {
    const { leftCents, reached } = goalProgress(earnedCents, goalCents);
    if (reached) return 'Goal reached. Everything from here is extra.';
    if (earnedCents <= 0) return `Today's goal: TT$${Math.round(goalCents / 100)}`;
    return `TT$${Math.ceil(leftCents / 100)} to today's goal`;
}

export function streakLine(days: number, todayDone: boolean): string {
    if (days === 0) return 'Finish a trip to start a streak';
    if (!todayDone) return `${days}-day streak · drive today to keep it`;
    return `${days}-day streak`;
}

// ---- earnings summary --------------------------------------------------------

// Only used when a finished ride has no recorded payout yet. The real share
// is 80% (78% while the driver's recruiter is an active commander); use the
// lowest so a screen never shows more than the driver will get. (Earnings
// used to assume 82%.)
export const SAFE_SHARE = 0.78;

export type EarnedRide = { completed_at: string | null; created_at?: string | null; driver_payout_cents: number | null; total_fare_cents: number | null };

export function payoutOf(r: Pick<EarnedRide, 'driver_payout_cents' | 'total_fare_cents'>): number {
    return r.driver_payout_cents ?? Math.round((r.total_fare_cents || 0) * SAFE_SHARE);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Today / this week (Monday start) / this month, plus the last 7 days as bars,
// all on Trinidad dates and by when the trip FINISHED.
export function summariseEarnings(rows: EarnedRide[], now: Date = new Date()) {
    const today = ttDay(now);
    const d = new Date(`${today}T12:00:00Z`);
    const dow = d.getUTCDay();
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    const last7: { day: string; label: string; cents: number; trips: number }[] = [];
    for (let i = 6; i >= 0; i--) {
        const x = new Date(d); x.setUTCDate(d.getUTCDate() - i);
        last7.push({ day: x.toISOString().slice(0, 10), label: i === 0 ? 'Today' : DAY_NAMES[x.getUTCDay()], cents: 0, trips: 0 });
    }
    const out = { todayCents: 0, todayTrips: 0, weekCents: 0, weekTrips: 0, monthCents: 0, monthTrips: 0, last7 };
    for (const r of rows) {
        const when = r.completed_at || r.created_at;
        if (!when) continue;
        const day = ttDay(when);
        const p = payoutOf(r);
        if (day === today) { out.todayCents += p; out.todayTrips += 1; }
        if (day >= weekStart && day <= today) { out.weekCents += p; out.weekTrips += 1; }
        if (day >= monthStart && day <= today) { out.monthCents += p; out.monthTrips += 1; }
        const bar = last7.find((b) => b.day === day);
        if (bar) { bar.cents += p; bar.trips += 1; }
    }
    return out;
}
