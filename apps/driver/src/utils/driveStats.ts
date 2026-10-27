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
