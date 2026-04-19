// AsyncStorage handled dynamically for web/adjutant compatibility
const getAsyncStorage = () => {
    try {
        return require('@react-native-async-storage/async-storage').default;
    } catch {
        return {
            getItem: async () => null,
            setItem: async () => {},
            removeItem: async () => {},
        };
    }
};
const AsyncStorage = getAsyncStorage();
import { supabase } from './supabase';

const OUTBOX_STORAGE_KEY = '@gtaxi_outbox_queue';

export interface OutboxAction {
    id: string;
    type: 'FUNCTION_INVOKE' | 'TABLE_UPDATE';
    name: string; // function name or table name
    payload: any;
    timestamp: number;
    retries: number;
}

export class OutboxService {
    private static instance: OutboxService;
    private isSyncing = false;

    private constructor() { }

    public static getInstance() {
        if (!OutboxService.instance) {
            OutboxService.instance = new OutboxService();
        }
        return OutboxService.instance;
    }

    /**
     * Enqueue a new action for eventual persistence
     */
    public async enqueue(action: Omit<OutboxAction, 'id' | 'timestamp' | 'retries'>) {
        const queue = await this.getQueue();
        const newAction: OutboxAction = {
            ...action,
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            retries: 0
        };

        queue.push(newAction);
        await this.saveQueue(queue);

        // Start sync attempt immediately
        this.processQueue();
    }

    /**
     * Main background processor
     */
    public async processQueue() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        let queue = await this.getQueue();
        if (queue.length === 0) {
            this.isSyncing = false;
            return;
        }

        console.log(`[Outbox] Processing ${queue.length} pending actions...`);

        let failIndex = -1;

        for (let i = 0; i < queue.length; i++) {
            const action = queue[i];
            try {
                const success = await this.executeAction(action);
                if (!success) {
                    console.warn(`[Outbox] Action ${action.id} (${action.name}) failed. Stopping queue.`);
                    action.retries++;
                    failIndex = i;
                    break; // STOP: Maintain strict order
                }
            } catch (error) {
                console.error(`[Outbox] Action ${action.id} error:`, error);
                action.retries++;
                failIndex = i;
                break; // STOP: Maintain strict order
            }
        }

        if (failIndex === -1) {
            // All succeeded
            await this.saveQueue([]);
        } else {
            // Keep failed action and all subsequent actions in the queue
            const remaining = queue.slice(failIndex);
            await this.saveQueue(remaining);

            // Exponential Backoff Retry (Phase 4 Hardening)
            const retryDelay = Math.min(1000 * Math.pow(2, queue[failIndex].retries), 60000);
            console.log(`[Outbox] Scheduling retry for ${queue[failIndex].id} in ${retryDelay/1000}s`);
            setTimeout(() => this.processQueue(), retryDelay);
        }

        this.isSyncing = false;
    }

    private async executeAction(action: OutboxAction): Promise<boolean> {
        if (action.type === 'FUNCTION_INVOKE') {
            const { error } = await supabase.functions.invoke(action.name, {
                body: action.payload
            });
            return !error;
        }

        if (action.type === 'TABLE_UPDATE') {
            const { error } = await supabase
                .from(action.name)
                .update(action.payload.data)
                .match(action.payload.match);
            return !error;
        }

        return true;
    }

    private async getQueue(): Promise<OutboxAction[]> {
        const raw = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    }

    private async saveQueue(queue: OutboxAction[]) {
        await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(queue));
    }
}
