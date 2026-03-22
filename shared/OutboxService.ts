import AsyncStorage from '@react-native-async-storage/async-storage';
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

        const remainingActions: OutboxAction[] = [];

        for (const action of queue) {
            try {
                const success = await this.executeAction(action);
                if (!success) {
                    action.retries++;
                    remainingActions.push(action);
                }
            } catch (error) {
                console.error(`[Outbox] Action ${action.id} failed:`, error);
                action.retries++;
                remainingActions.push(action);
            }
        }

        await this.saveQueue(remainingActions);
        this.isSyncing = false;

        // If there were failures, schedule another attempt in 5 seconds
        if (remainingActions.length > 0) {
            setTimeout(() => this.processQueue(), 5000);
        }
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
