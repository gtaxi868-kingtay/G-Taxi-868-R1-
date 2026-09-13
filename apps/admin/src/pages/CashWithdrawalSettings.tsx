import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { RefreshCw, ToggleLeft, ToggleRight, DollarSign, Phone, CheckCircle, XCircle, Send } from 'lucide-react';

interface WithdrawalRequest {
  id: string;
  user_id: string;
  user_type: string;
  amount_ttd: number;
  fee_ttd: number;
  phone_number: string;
  status: string;
  expires_at: string;
  requested_at: string;
  completed_at: string | null;
  republic_bank_reference: string | null;
  profile_name?: string;
}

export function CashWithdrawalSettings() {
  const [enabled, setEnabled] = useState(false);
  const [minAmount, setMinAmount] = useState('5000');
  const [maxDaily, setMaxDaily] = useState('150000');
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const flash = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadConfig = useCallback(async () => {
    const { data: config } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', 'cash_withdrawal_config')
      .maybeSingle();

    if (config?.value) {
      try {
        const parsed = JSON.parse(config.value);
        setEnabled(parsed.enabled ?? false);
        setMinAmount(String(parsed.min_amount_cents ?? 5000));
        setMaxDaily(String(parsed.max_daily_cents ?? 150000));
      } catch { }
    }
  }, []);

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('status', statusFilter)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('Failed to load withdrawal requests:', error);
      return;
    }

    const rows = (data || []) as WithdrawalRequest[];
    const userIds = [...new Set(rows.map(r => r.user_id))];

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const nameMap: Record<string, string> = {};
      if (profiles) {
        for (const p of profiles) {
          nameMap[p.id] = (p as any).full_name || 'Unknown';
        }
      }
      rows.forEach(r => { r.profile_name = nameMap[r.user_id] || 'Unknown'; });
    }

    setRequests(rows);
  }, [statusFilter]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const saveConfig = async (newEnabled: boolean) => {
    setSaving('config');
    const config = JSON.stringify({
      enabled: newEnabled,
      min_amount_cents: parseInt(minAmount) || 5000,
      max_daily_cents: parseInt(maxDaily) || 150000,
    });
    const { error } = await supabase.rpc('admin_set_system_config', {
      p_key: 'cash_withdrawal_config',
      p_value: config,
    });
    if (error) {
      flash(`Failed to save: ${error.message}`, false);
    } else {
      setEnabled(newEnabled);
      flash(`Cash withdrawals ${newEnabled ? 'ENABLED' : 'DISABLED'}`, true);
    }
    setSaving(null);
  };

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    const { data, error } = await supabase.rpc('admin_update_withdrawal_status', {
      p_withdrawal_id: id,
      p_status: status,
    });
    if (error || !(data as any)?.success) {
      flash(`Failed to update: ${(error || (data as any)?.error)?.message || 'unknown'}`, false);
    } else {
      flash(`Request ${status}`, true);
      loadRequests();
    }
    setUpdatingId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-white italic">CASH WITHDRAWAL</h2>
          <p className="text-xs text-white/30 uppercase tracking-widest mt-1">
            Cardless cash via Republic Bank SMS — riders, drivers & commanders
          </p>
        </div>
        <button onClick={() => { loadConfig(); loadRequests(); }} className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/40 hover:text-white transition-all">
          <RefreshCw size={18} />
        </button>
      </div>

      {msg && (
        <div className={`px-5 py-3 rounded-xl border text-sm font-bold ${msg.ok ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {msg.text}
        </div>
      )}

      <section>
        <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <DollarSign size={20} className={enabled ? 'text-cyan-400' : 'text-white/40'} />
              <div>
                <h3 className="font-black text-white uppercase tracking-wider text-sm">Cash Withdrawal</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">
                  {enabled ? 'Active — users can request cash withdrawals' : 'Disabled — feature hidden'}
                </p>
              </div>
            </div>
            <button
              onClick={() => saveConfig(!enabled)}
              disabled={saving === 'config'}
              className="flex items-center gap-2 disabled:opacity-40"
            >
              {saving === 'config' ? (
                <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              ) : enabled ? (
                <ToggleRight size={32} className="text-cyan-400" />
              ) : (
                <ToggleLeft size={32} className="text-white/20" />
              )}
              <span className={`text-xs font-black uppercase tracking-widest ${enabled ? 'text-cyan-400' : 'text-white/20'}`}>
                {enabled ? 'Live' : 'Off'}
              </span>
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-widest">Min Amount (cents)</label>
              <input
                type="number"
                value={minAmount}
                onChange={e => setMinAmount(e.target.value)}
                className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-cyan-400/50"
              />
            </div>
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-widest">Max Daily (cents)</label>
              <input
                type="number"
                value={maxDaily}
                onChange={e => setMaxDaily(e.target.value)}
                className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-cyan-400/50"
              />
            </div>
          </div>

          <button
            onClick={() => saveConfig(enabled)}
            disabled={saving === 'config'}
            className="mt-4 px-4 py-2 bg-cyan-500/20 border border-cyan-400/30 text-cyan-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-cyan-500/30 disabled:opacity-40"
          >
            {saving === 'config' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-4">
          <Phone size={18} className="text-green-400" />
          <div>
            <h3 className="font-black text-white uppercase tracking-wider text-sm">Withdrawal Requests</h3>
            <p className="text-[10px] text-white/30 uppercase tracking-widest">
              Users request cash sent via Republic Bank SMS
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {['pending', 'sent', 'completed', 'expired', 'failed'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${statusFilter === s ? 'bg-green-500/20 border-green-400/30 text-green-400' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {requests.length === 0 ? (
            <div className="bg-white/5 rounded-2xl p-8 text-center">
              <p className="text-white/30 text-sm font-bold">No {statusFilter} requests</p>
            </div>
          ) : (
            requests.map(r => (
              <div key={r.id} className="bg-white/5 rounded-2xl p-5 border border-white/10">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-white text-sm">{r.profile_name}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">
                      {r.user_type} · TTD ${(r.amount_ttd / 100).toFixed(2)} + ${(r.fee_ttd / 100).toFixed(2)} fee
                    </p>
                    <p className="text-[10px] text-white/20 font-mono mt-0.5">
                      Phone: {r.phone_number} · {new Date(r.requested_at).toLocaleString()}
                    </p>
                    {r.republic_bank_reference && (
                      <p className="text-[10px] text-cyan-400/60 mt-0.5">
                        Ref: {r.republic_bank_reference}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === 'pending' && (
                      <>
                        <button
                          onClick={() => updateStatus(r.id, 'sent')}
                          disabled={updatingId === r.id}
                          className="flex items-center gap-1 px-4 py-2 bg-blue-500/20 border border-blue-400/30 text-blue-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-blue-500/30 disabled:opacity-40"
                        >
                          <Send size={12} />
                          Mark Sent
                        </button>
                        <button
                          onClick={() => updateStatus(r.id, 'failed')}
                          disabled={updatingId === r.id}
                          className="flex items-center gap-1 px-4 py-2 bg-red-500/20 border border-red-400/30 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-red-500/30 disabled:opacity-40"
                        >
                          <XCircle size={12} />
                          Fail
                        </button>
                      </>
                    )}
                    {r.status === 'sent' && (
                      <button
                        onClick={() => updateStatus(r.id, 'completed')}
                        disabled={updatingId === r.id}
                        className="flex items-center gap-1 px-4 py-2 bg-green-500/20 border border-green-400/30 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-green-500/30 disabled:opacity-40"
                      >
                        <CheckCircle size={12} />
                        Complete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
