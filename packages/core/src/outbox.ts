import AsyncStorage from '@react-native-async-storage/async-storage';

const OUTBOX_KEY = '@gtaxi/outbox';

export interface OutboxAction {
  id: string;
  type: 'FUNCTION_INVOKE';
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class OutboxService {
  private static instance: OutboxService;

  static getInstance(): OutboxService {
    if (!OutboxService.instance) {
      OutboxService.instance = new OutboxService();
    }
    return OutboxService.instance;
  }

  async enqueue(action: Omit<OutboxAction, 'id' | 'createdAt'>): Promise<void> {
    const queue = await this.getQueue();
    queue.push({
      ...action,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    });
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  }

  async processQueue(): Promise<void> {
    const queue = await this.getQueue();
    if (queue.length === 0) return;

    const remaining: OutboxAction[] = [];
    for (const action of queue) {
      try {
        const { supabase } = await import('./native');
        const { error } = await supabase.functions.invoke(action.name, {
          body: action.payload,
        });
        if (error) {
          remaining.push(action);
        }
      } catch {
        remaining.push(action);
      }
    }
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  }

  private async getQueue(): Promise<OutboxAction[]> {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  }
}
