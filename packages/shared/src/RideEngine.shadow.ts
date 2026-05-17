/**
 * G-TAXI RIDE ENGINE (SHADOW LAYER)
 * 
 * This module wraps existing production ride flows to monitor and validate 
 * behavioral consistency before the full migration to a centralized state machine.
 */

import { supabase } from '../supabase';

export interface ShadowLogEntry {
    ride_id: string;
    flow: string;
    input: any;
    output: any;
    timestamp: string;
    status: 'success' | 'mismatch' | 'error';
}

class RideEngineShadow {
    private static instance: RideEngineShadow;

    private constructor() {}

    public static getInstance(): RideEngineShadow {
        if (!RideEngineShadow.instance) {
            RideEngineShadow.instance = new RideEngineShadow();
        }
        return RideEngineShadow.instance;
    }

    private log(entry: ShadowLogEntry) {
        console.log(`[SHADOW][${entry.flow}]`, JSON.stringify(entry, null, 2));
        // Future: persist to a shadow_logs table for aggregation
    }

    /**
     * SHADOW WRAPPER: createRide
     * Calls existing Edge Function and monitors output.
     */
    public async requestRide(params: any, originalFn: Function): Promise<any> {
        const timestamp = new Date().toISOString();
        try {
            const result = await originalFn(params);
            
            this.log({
                ride_id: result.data?.ride_id || 'new',
                flow: 'requestRide',
                input: params,
                output: result,
                timestamp,
                status: 'success'
            });

            return result;
        } catch (error) {
            this.log({
                ride_id: 'error',
                flow: 'requestRide',
                input: params,
                output: { error: error instanceof Error ? error.message : 'Unknown error' },
                timestamp,
                status: 'error'
            });
            throw error;
        }
    }

    /**
     * SHADOW WRAPPER: acceptRide
     */
    public async acceptRide(offerId: string, originalFn: Function): Promise<any> {
        const timestamp = new Date().toISOString();
        try {
            const result = await originalFn(offerId);
            
            this.log({
                ride_id: result.ride_id || 'unknown',
                flow: 'acceptRide',
                input: { offerId },
                output: result,
                timestamp,
                status: 'success'
            });

            return result;
        } catch (error) {
            this.log({
                ride_id: 'error',
                flow: 'acceptRide',
                input: { offerId },
                output: { error: error instanceof Error ? error.message : 'Unknown error' },
                timestamp,
                status: 'error'
            });
            throw error;
        }
    }

    /**
     * SHADOW WRAPPER: completeRide
     */
    public async completeRide(rideId: string, originalFn: Function): Promise<any> {
        const timestamp = new Date().toISOString();
        try {
            const result = await originalFn(rideId);
            
            this.log({
                ride_id: rideId,
                flow: 'completeRide',
                input: { rideId },
                output: result,
                timestamp,
                status: 'success'
            });

            return result;
        } catch (error) {
            this.log({
                ride_id: rideId,
                flow: 'completeRide',
                input: { rideId },
                output: { error: error instanceof Error ? error.message : 'Unknown error' },
                timestamp,
                status: 'error'
            });
            throw error;
        }
    }
}

export const RideEngine = RideEngineShadow.getInstance();
