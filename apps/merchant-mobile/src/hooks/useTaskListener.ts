import { useEffect, useRef } from 'react';
import { initializeSupabaseClient } from '@gtaxi/core';

const { supabase } = initializeSupabaseClient('native');

export interface ServiceTask {
  id: string;
  merchant_id: string;
  puck_id: string | null;
  task_type: string;
  status: string;
  created_at: string;
}

export type TaskCallback = (task: ServiceTask) => void;

export function useTaskListener(puckId: string | null, onTask: TaskCallback): void {
  const callbackRef = useRef<TaskCallback>(onTask);
  callbackRef.current = onTask;

  useEffect(() => {
    if (!puckId) return;

    const broadcastChannel = supabase.channel(`puck:${puckId}`);
    broadcastChannel
      .on('broadcast', { event: 'new_task' }, (payload) => {
        callbackRef.current(payload.payload as ServiceTask);
      })
      .subscribe();

    const dbChannel = supabase
      .channel(`puck-db-${puckId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `puck_id=eq.${puckId}`,
        },
        (payload) => {
          callbackRef.current(payload.new as ServiceTask);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
      supabase.removeChannel(dbChannel);
    };
  }, [puckId]);
}
