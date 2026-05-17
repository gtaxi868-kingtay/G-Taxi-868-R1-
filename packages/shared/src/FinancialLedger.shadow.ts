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
     */
    public simulateCompletionSplit(totalFareCents: number, commissionTier: string = 'standard') {
        const rates: Record<string, number> = {
            'standard': 0.22,
            'pioneer': 0.19
        };

        const rate = rates[commissionTier] || 0.22;
        const platformFee = Math.round(totalFareCents * rate);
        const driverPayout = totalFareCents - platformFee;

        const result = {
            grossCents: totalFareCents,
            platformFeeCents: platformFee,
            driverPayoutCents: driverPayout,
            rateUsed: rate
        };

        this.log('simulateCompletionSplit', { totalFareCents, commissionTier }, result);
        return result;
    }
}

export const FinancialLedger = FinancialLedgerShadow.getInstance();
