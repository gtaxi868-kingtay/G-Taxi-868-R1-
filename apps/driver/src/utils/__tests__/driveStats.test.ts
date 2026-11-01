import { computeStreak, goalProgress, goalLine, streakLine, ttDay } from '../driveStats';

// 2026-10-27 15:00 in Trinidad = 19:00 UTC
const NOW = new Date('2026-10-27T19:00:00Z');

describe('drive stats', () => {
    it('uses Trinidad dates, not UTC', () => {
        // 23:30 TT on the 26th is 03:30 UTC on the 27th
        expect(ttDay('2026-10-27T03:30:00Z')).toBe('2026-10-26');
    });

    it('counts consecutive days ending today', () => {
        const s = computeStreak(['2026-10-27T13:00:00Z', '2026-10-26T13:00:00Z', '2026-10-25T13:00:00Z', '2026-10-23T13:00:00Z'], NOW);
        expect(s).toEqual({ days: 3, todayDone: true });
    });

    it('keeps yesterday\'s streak alive until today ends', () => {
        const s = computeStreak(['2026-10-26T13:00:00Z', '2026-10-25T13:00:00Z'], NOW);
        expect(s).toEqual({ days: 2, todayDone: false });
        expect(streakLine(s.days, s.todayDone)).toMatch(/drive today to keep it/);
    });

    it('is zero after a missed day, with a friendly line', () => {
        const s = computeStreak(['2026-10-24T13:00:00Z'], NOW);
        expect(s.days).toBe(0);
        expect(streakLine(0, false)).toBe('Finish a trip to start a streak');
        expect(computeStreak([], NOW).days).toBe(0);
    });

    it('counts several trips on one day once', () => {
        expect(computeStreak(['2026-10-27T13:00:00Z', '2026-10-27T15:00:00Z'], NOW).days).toBe(1);
    });

    it('tracks the daily goal', () => {
        expect(goalProgress(15000, 30000)).toEqual({ ratio: 0.5, leftCents: 15000, reached: false });
        expect(goalProgress(40000, 30000).reached).toBe(true);
        expect(goalProgress(40000, 30000).ratio).toBe(1);
        expect(goalLine(0, 30000)).toBe("Today's goal: TT$300");
        expect(goalLine(12050, 30000)).toBe("TT$180 to today's goal");
        expect(goalLine(30000, 30000)).toMatch(/Goal reached/);
    });
});

import { summariseEarnings, payoutOf } from '../driveStats';

describe('earnings summary', () => {
  // NOW = Tue 2026-10-27 15:00 TT
  const rows = [
    { completed_at: '2026-10-27T13:00:00Z', driver_payout_cents: 4000, total_fare_cents: 5000 },        // today
    { completed_at: '2026-10-27T03:30:00Z', driver_payout_cents: 1000, total_fare_cents: 1250 },        // 23:30 Mon TT -> yesterday
    { completed_at: '2026-10-25T13:00:00Z', driver_payout_cents: null, total_fare_cents: 10000 },       // Sun, last week
    { completed_at: '2026-09-30T13:00:00Z', driver_payout_cents: 9999, total_fare_cents: 9999 },        // last month
  ];
  it('splits today / week (from Monday) / month on Trinidad dates', () => {
    const s = summariseEarnings(rows, NOW);
    expect(s.todayCents).toBe(4000);
    expect(s.todayTrips).toBe(1);
    expect(s.weekCents).toBe(5000);
    expect(s.monthCents).toBe(4000 + 1000 + 7800);
    expect(s.last7.map((b) => b.label)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Today']);
    expect(s.last7[6].cents).toBe(4000);
    expect(s.last7[5].cents).toBe(1000);
  });
  it('never estimates more than 78% when a payout is missing', () => {
    expect(payoutOf({ driver_payout_cents: null, total_fare_cents: 10000 })).toBe(7800);
    expect(payoutOf({ driver_payout_cents: 8000, total_fare_cents: 10000 })).toBe(8000);
  });
});
