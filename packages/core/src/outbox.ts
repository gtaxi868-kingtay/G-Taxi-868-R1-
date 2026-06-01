import AsyncStorage from '@react-native-async-storage/async-storage';

const OUTBOX_KEY = '@gtaxi/outbox';
const MAX_RETRIES = 5;

export type OutboxActionType =
  | 'FUNCTION_INVOKE'
  | 'TAP_EVENT'
  | 'RIDE_EVENT'
  | 'STOP_EVENT'
  | 'HANDOFF_EVENT';

export interface OutboxAction {
  id: string;
  type: OutboxActionType;
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string;
}

export interface ProofEvent {
  eventType: OutboxActionType;
  tagUid: string;
  userId: string;
  rideId?: string;
  driverId?: string;
  merchantId?: string;
  nodeId?: string;
  lat?: number;
  lng?: number;
  nonce: string;
  timestamp: string;
}

export class OutboxService {
  private static instance: OutboxService;

  static getInstance(): OutboxService {
    if (!OutboxService.instance) {
      OutboxService.instance = new OutboxService();
    }
    return OutboxService.instance;
  }

  async enqueue(action: Omit<OutboxAction, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<void> {
    const queue = await this.getQueue();
    queue.push({
      ...action,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    });
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  }

  async enqueueProofEvent(event: ProofEvent): Promise<void> {
    await this.enqueue({
      type: event.eventType,
      name: 'nfc_event_handler',
      payload: event as unknown as Record<string, unknown>,
    });
  }

  async processQueue(): Promise<void> {
    const queue = await this.getQueue();
    if (queue.length === 0) return;

    const remaining: OutboxAction[] = [];
    for (const action of queue) {
      if (action.status === 'synced') {
        continue;
      }

      if (action.retryCount >= MAX_RETRIES) {
        action.status = 'failed';
        remaining.push(action);
        continue;
      }

      try {
        const { supabase } = await import('./native');
        const { error } = await supabase.functions.invoke(action.name, {
          body: action.payload,
        });
        if (error) {
          action.retryCount += 1;
          action.lastError = error.message;
          action.status = 'pending';
          remaining.push(action);
        } else {
          action.status = 'synced';
          remaining.push(action);
        }
      } catch (err: any) {
        action.retryCount += 1;
        action.lastError = err?.message || 'Unknown error';
        action.status = 'pending';
        remaining.push(action);
      }
    }
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  }

  async getPendingCount(): Promise<number> {
    const queue = await this.getQueue();
    return queue.filter(a => a.status === 'pending').length;
  }

  async getFailedActions(): Promise<OutboxAction[]> {
    const queue = await this.getQueue();
    return queue.filter(a => a.status === 'failed');
  }

  async clearSynced(): Promise<void> {
    const queue = await this.getQueue();
    const remaining = queue.filter(a => a.status !== 'synced');
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  }

  private async getQueue(): Promise<OutboxAction[]> {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  }
}
