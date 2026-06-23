/**
 * G-TAXI FINANCIAL LEDGER (SHADOW LAYER)
 * 
 * Simulates and mirrors financial calculations without affecting the real DB.
 */

export class FinancialLedgerShadow {
    private static instance: FinancialLedgerShadow;

    private constructor() {}

    public static getInstance(): FinancialLedgerShadow {
        if (!FinancialLedgerShadow.instance) {
            FinancialLedgerShadow.instance = new FinancialLedgerShadow();
        }
        return FinancialLedgerShadow.instance;
    }

    private log(flow: string, input: any, output: any) {
        console.log(`[SHADOW_LEDGER][${flow}]`, {
            timestamp: new Date().toISOString(),
            input,
            output,
            isSimulation: true
        });
    }

    /**
     * SHADOW: calculateFarePreview
     * Mirrors the backend pricing logic for client-side estimation consistency.
     */
    public calculateFarePreview(distanceMeters: number, durationSeconds: number, vehicleType: string = 'Standard') {
        const BASE_FARE = 1600;
        const PER_KM = 175;
        const PER_MIN = 95;
        const MIN_FARE = 2200;

        const multipliers: Record<string, number> = {
            'Standard': 1.0,
            'XL': 1.5,
            'Premium': 2.0
        };

        const distanceKm = distanceMeters / 1000;
        const durationMin = durationSeconds / 60;

        let total = (BASE_FARE + (distanceKm * PER_KM) + (durationMin * PER_MIN)) * (multipliers[vehicleType] || 1.0);
        total = Math.max(total, MIN_FARE);

        const result = {
            baseFare: BASE_FARE,
            distanceFare: distanceKm * PER_KM,
            timeFare: durationMin * PER_MIN,
            totalFareCents: Math.round(total)
        };

        this.log('calculateFarePreview', { distanceMeters, durationSeconds, vehicleType }, result);
        return result;
    }

    /**
     * SHADOW: simulateCompletionSplit
     * Predicts the payout split based on commission tiers.
     * Current model: 82% driver / 15% platform / 3% growth reserve.
     * Loyalty: 88% driver / 12% platform (waived growth reserve).
     * Pioneer: 85% driver / 12% platform / 3% reserve.
     */
    public simulateCompletionSplit(totalFareCents: number, commissionTier: string = 'standard') {
        const rates: Record<string, number> = {
            'standard': 0.15,
            'pioneer': 0.12,
            'loyalty': 0.12,
        };
        const reserves: Record<string, number> = {
            'standard': 0.03,
            'pioneer': 0.03,
            'loyalty': 0,
        };

        const rate = rates[commissionTier] || 0.15;
        const reserve = reserves[commissionTier] || 0.03;
        const platformFee = Math.round(totalFareCents * rate);
        const reserveFee = Math.round(totalFareCents * reserve);
        const driverPayout = totalFareCents - platformFee - reserveFee;

        const result = {
            grossCents: totalFareCents,
            platformFeeCents: platformFee,
            reserveFeeCents: reserveFee,
            driverPayoutCents: driverPayout,
            rateUsed: rate,
            reserveRate: reserve,
        };

        this.log('simulateCompletionSplit', { totalFareCents, commissionTier }, result);
        return result;
    }
}

export const FinancialLedger = FinancialLedgerShadow.getInstance();
