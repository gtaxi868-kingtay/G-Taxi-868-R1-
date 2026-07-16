import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DollarSign, Music, Calendar, CheckCircle, XCircle, Clock, History, TrendingUp, Users, RefreshCw, Banknote, RotateCcw, Plus, Edit2, Scale, Landmark } from 'lucide-react';

interface PendingOrganizer {
  ledger_type: 'band' | 'event';
  organizer_id: string;
  organizer_name: string;
  pending_rides: number;
  pending_cents: number;
  oldest_pending: string;
}

interface PayoutRecord {
  id: string;
  ledger_type: 'band' | 'event';
  organizer_id: string;
  organizer_name: string;
  total_cents: number;
  ride_count: number;
  status: string;
  notes: string | null;
  processed_by: string | null;
  created_at: string;
  wipay_status: string | null;
  wipay_transaction_id: string | null;
  wipay_error: string | null;
}

interface BankAccount {
  id: string;
  organizer_id: string;
  ledger_type: string;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  account_type: string;
  is_default: boolean;
  is_verified: boolean;
}

export const RevshareSettlement = () => {
  const [activeTab, setActiveTab] = useState<'bands' | 'events'>('bands');
  const [pendingBands, setPendingBands] = useState<PendingOrganizer[]>([]);
  const [pendingEvents, setPendingEvents] = useState<PendingOrganizer[]>([]);
  const [payoutHistory, setPayoutHistory] = useState<PayoutRecord[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bankModal, setBankModal] = useState<{ open: boolean; organizerId: string; ledgerType: string; organizerName: string; banks: BankAccount[] }>({ open: false, organizerId: '', ledgerType: '', organizerName: '', banks: [] });
  const [bankForm, setBankForm] = useState({ bank_name: '', account_holder_name: '', account_number: '', account_type: 'savings' });
  const [savingBank, setSavingBank] = useState(false);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const { data: fnData } = await supabase.functions.invoke('process_revshare_payouts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        method: 'GET',
      });

      if (fnData?.success) {
        setPendingBands(fnData.data.pending_bands ?? []);
        setPendingEvents(fnData.data.pending_events ?? []);
        setPayoutHistory(fnData.data.payout_history ?? []);
      }
    } catch (err) {
      console.error('Failed to load revshare data:', err);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openBankModal = async (ledgerType: string, organizerId: string, organizerName: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const { data: banks } = await supabase.rpc('admin_get_organizer_banks', {
        p_organizer_id: organizerId,
        p_ledger_type: ledgerType,
      }).catch(() => ({ data: [] }));
      setBankModal({ open: true, organizerId, ledgerType, organizerName, banks });
      setBankForm({ bank_name: '', account_holder_name: '', account_number: '', account_type: 'savings' });
    } catch {
      setBankModal({ open: true, organizerId, ledgerType, organizerName, banks: [] });
    }
  };

  const saveBank = async () => {
    if (!bankForm.bank_name || !bankForm.account_holder_name || !bankForm.account_number) return;
    setSavingBank(true);

    try {
      await supabase.rpc('admin_upsert_organizer_bank', {
        p_organizer_id: bankModal.organizerId,
        p_ledger_type: bankModal.ledgerType,
        p_bank_name: bankForm.bank_name,
        p_account_holder_name: bankForm.account_holder_name,
        p_account_number: bankForm.account_number,
        p_account_type: bankForm.account_type,
        p_is_default: bankModal.banks.length === 0,
      });
      openBankModal(bankModal.ledgerType, bankModal.organizerId, bankModal.organizerName);
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to save bank account' });
    } finally {
      setSavingBank(false);
    }
  };

  const handlePayout = async (ledger_type: 'band' | 'event', organizer_id: string, organizer_name: string) => {
    setProcessing(organizer_id);
    setStatusMsg(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: result } = await supabase.functions.invoke('process_revshare_payouts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        method: 'POST',
        body: { ledger_type, organizer_id },
      });

      if (result?.success && result?.results?.length > 0) {
        const paid = result.results[0];
        const wipayMsg = paid.wipay?.status === 'submitted' ? ' + WiPay submitted'
          : paid.wipay?.status === 'pending' ? ' (no WiPay — set bank details)'
          : paid.wipay?.status === 'failed' ? ` (WiPay: ${paid.wipay.error})`
          : '';
        setStatusMsg({
          type: 'success',
          text: `$${(paid.total_cents / 100).toFixed(2)} paid to ${organizer_name} (${paid.ride_count} rides${wipayMsg})`,
        });
        loadData();
      } else {
        setStatusMsg({
          type: 'error',
          text: result?.errors?.[0]?.error ?? 'Payout failed',
        });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to process payout' });
    } finally {
      setProcessing(null);
    }
  };

  const handlePayAll = async (ledger_type: 'band' | 'event') => {
    setProcessingAll(true);
    setStatusMsg(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: result } = await supabase.functions.invoke('process_revshare_payouts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        method: 'POST',
        body: { ledger_type },
      });

      if (result?.success) {
        const total = result.summary.total_cents_paid;
        const count = result.summary.total_organizers_paid;
        setStatusMsg({
          type: 'success',
          text: `$${(total / 100).toFixed(2)} paid to ${count} organizer${count !== 1 ? 's' : ''}`,
        });
        loadData();
      } else {
        setStatusMsg({ type: 'error', text: 'Batch payout failed' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to process batch payout' });
    } finally {
      setProcessingAll(false);
    }
  };

  const handleRetryWipay = async (payoutId: string) => {
    setProcessing(`retry-${payoutId}`);
    setStatusMsg(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: result } = await supabase.functions.invoke('process_revshare_payouts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        method: 'POST',
        body: { retry_payout_id: payoutId },
      });

      if (result?.success) {
        setStatusMsg({ type: 'success', text: `WiPay retry submitted for payout` });
        loadData();
      } else {
        setStatusMsg({ type: 'error', text: result?.wipay?.error ?? 'WiPay retry failed' });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to retry WiPay' });
    } finally {
      setProcessing(null);
    }
  };

  const pendingItems = activeTab === 'bands' ? pendingBands : pendingEvents;
  const totalPendingCents = pendingItems.reduce((sum, p) => sum + p.pending_cents, 0);
  const totalPendingRides = pendingItems.reduce((sum, p) => sum + Number(p.pending_rides), 0);
  const totalHistoricalCents = payoutHistory.reduce((sum, p) => sum + p.total_cents, 0);
  const totalRevshareGross = totalPendingCents + totalHistoricalCents;
  const birReserveCents = Math.round(totalRevshareGross * 0.125);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {statusMsg && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 ${
          statusMsg.type === 'success' ? 'bg-green-900/30 border-green-500/40 text-green-300' : 'bg-red-900/30 border-red-500/40 text-red-300'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          <span className="text-sm font-mono">{statusMsg.text}</span>
        </div>
      )}

      {/* KPI GRID */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Pending Bands" value={pendingBands.length.toString()} icon={<Music className="text-pink-400" />} />
        <StatCard title="Pending Events" value={pendingEvents.length.toString()} icon={<Calendar className="text-purple-400" />} />
        <StatCard title="Total Pending" value={`$${(totalPendingCents / 100).toFixed(2)}`} icon={<DollarSign className="text-cyan-400" />} isHighlight />
        <StatCard title="Pending Rides" value={totalPendingRides.toString()} icon={<TrendingUp className="text-yellow-400" />} />
      </div>

      {/* BIR 12.5% VAT ESCROW LEDGER ROW */}
      {totalRevshareGross > 0 && (
        <div className="bg-gradient-to-r from-emerald-500/5 via-emerald-500/3 to-transparent border border-emerald-500/15 rounded-[2rem] p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Landmark size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-[10px] font-black text-emerald-400/80 uppercase tracking-widest">Tax Reserve</p>
                <p className="text-sm font-black text-white">BIR 12.5% VAT Escrow</p>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Gross Revshare</p>
                <p className="text-sm font-black text-white">${(totalRevshareGross / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">12.5% VAT Owed</p>
                <p className="text-sm font-black text-emerald-400">${(birReserveCents / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Pending Payouts</p>
                <p className="text-sm font-black text-amber-400">${(totalPendingCents / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-0.5">Historical Paid</p>
                <p className="text-sm font-black text-cyan-400">${(totalHistoricalCents / 100).toFixed(2)}</p>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">VAT Obligation</span>
              <span className="text-[9px] font-bold text-white/40">${(birReserveCents / 100).toFixed(2)} at 12.5%</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-700"
                style={{ width: `${totalRevshareGross > 0 ? Math.min(100, (totalHistoricalCents / totalRevshareGross) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB TOGGLE + PAY ALL */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('bands')}
            className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === 'bands' ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40' : 'bg-white/5 text-white/40 border border-white/10 hover:text-white'
            }`}
          >
            <Music size={14} className="inline mr-2" />
            Carnival Bands
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === 'events' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'bg-white/5 text-white/40 border border-white/10 hover:text-white'
            }`}
          >
            <Calendar size={14} className="inline mr-2" />
            Event Organizers
          </button>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadData}
            className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white text-xs font-black uppercase tracking-widest transition-all"
          >
            <RefreshCw size={14} className="inline mr-2" />
            Refresh
          </button>
          {pendingItems.length > 0 && (
            <button
              onClick={() => handlePayAll(activeTab === 'bands' ? 'band' : 'event')}
              disabled={processingAll}
              className="px-6 py-3 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 transition-all disabled:opacity-50"
            >
              {processingAll ? 'Processing...' : `Pay All (${pendingItems.length})`}
            </button>
          )}
        </div>
      </div>

      {/* PENDING LIST */}
      <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
        <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-white/[0.02] to-transparent">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-cyan-400" />
            <h3 className="text-sm font-black uppercase tracking-widest text-white/80">
              Pending {activeTab === 'bands' ? 'Band' : 'Event'} Revshare
            </h3>
          </div>
          <span className="text-xs font-mono text-white/30">{pendingItems.length} organizer{pendingItems.length !== 1 ? 's' : ''}</span>
        </div>

        {pendingItems.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <CheckCircle size={40} className="mx-auto mb-4 text-green-400/60" />
            <p className="text-white/40 text-sm font-medium">All caught up — no pending revshare records</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {pendingItems.map((item) => (
              <div key={`${item.ledger_type}-${item.organizer_id}`} className="px-8 py-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    {item.ledger_type === 'band' ? <Music size={16} className="text-pink-400/60" /> : <Calendar size={16} className="text-purple-400/60" />}
                    <span className="text-sm font-bold text-white/80">{item.organizer_name}</span>
                    <button
                      onClick={() => openBankModal(item.ledger_type, item.organizer_id, item.organizer_name)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/30 hover:text-white/60 transition-all"
                      title="Manage bank account"
                    >
                      <Banknote size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-white/30 font-mono">
                    <span>{Number(item.pending_rides)} rides</span>
                    <span>${(item.pending_cents / 100).toFixed(2)}</span>
                    {item.oldest_pending && (
                      <span>Oldest: {new Date(item.oldest_pending).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handlePayout(item.ledger_type, item.organizer_id, item.organizer_name)}
                  disabled={processing === item.organizer_id}
                  className="px-5 py-2.5 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-black uppercase tracking-widest hover:bg-green-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing === item.organizer_id ? (
                    <span className="flex items-center gap-2"><Clock size={14} className="animate-spin" /> Paying...</span>
                  ) : (
                    <span className="flex items-center gap-2"><DollarSign size={14} /> Pay ${(item.pending_cents / 100).toFixed(2)}</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PAYOUT HISTORY */}
      <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
        <div className="px-8 py-6 border-b border-white/5 flex items-center gap-3 bg-gradient-to-r from-white/[0.02] to-transparent">
          <History size={18} className="text-cyan-400" />
          <h3 className="text-sm font-black uppercase tracking-widest text-white/80">Payout History</h3>
          <span className="ml-auto text-xs font-mono text-white/30">{payoutHistory.length} payouts</span>
        </div>

        {payoutHistory.length === 0 ? (
          <div className="px-8 py-16 text-center">
            <History size={40} className="mx-auto mb-4 text-white/10" />
            <p className="text-white/30 text-sm font-medium">No payouts yet</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {payoutHistory.map((payout) => {
              const wipayFailed = payout.wipay_status === 'failed';
              return (
                <div key={payout.id} className="px-8 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-4">
                    {payout.ledger_type === 'band' ? <Music size={14} className="text-pink-400/60" /> : <Calendar size={14} className="text-purple-400/60" />}
                    <div>
                      <span className="text-sm font-semibold text-white/70">{payout.organizer_name}</span>
                      <div className="text-xs text-white/30 font-mono mt-0.5">
                        {payout.ride_count} rides &middot; {new Date(payout.created_at).toLocaleDateString()} &middot; {new Date(payout.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-sm font-bold text-green-400">${(payout.total_cents / 100).toFixed(2)}</span>
                      <div className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${
                        payout.wipay_status === 'submitted' ? 'text-cyan-400/60'
                        : payout.wipay_status === 'failed' ? 'text-red-400/60'
                        : payout.wipay_status === 'pending' ? 'text-yellow-400/60'
                        : 'text-green-400/60'
                      }`}>
                        {payout.wipay_status ?? 'completed'}
                        {payout.wipay_transaction_id ? ` · ${payout.wipay_transaction_id.slice(0, 8)}` : ''}
                      </div>
                    </div>
                    {wipayFailed && (
                      <button
                        onClick={() => handleRetryWipay(payout.id)}
                        disabled={processing === `retry-${payout.id}`}
                        className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                        title="Retry WiPay disbursement"
                      >
                        <RotateCcw size={14} className={processing === `retry-${payout.id}` ? 'animate-spin' : ''} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BANK ACCOUNT MODAL */}
      {bankModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBankModal({ ...bankModal, open: false })}>
          <div className="bg-[#0f0d1a] border border-white/10 rounded-[2rem] p-8 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-6">
              <Banknote size={20} className="text-cyan-400" />
              <h3 className="text-sm font-black uppercase tracking-widest text-white/80">Bank Account — {bankModal.organizerName}</h3>
            </div>

            {/* Existing banks */}
            {bankModal.banks.length > 0 && (
              <div className="mb-6 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-3">Registered Accounts</p>
                {bankModal.banks.map((b) => (
                  <div key={b.id} className="px-4 py-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-white/70">{b.bank_name}</span>
                      <span className="text-xs text-white/30 ml-3 font-mono">
                        {b.account_holder_name} · ****{b.account_number.slice(-4)} · {b.account_type}
                      </span>
                      {b.is_default && <span className="text-[10px] text-cyan-400 ml-2 font-black">DEFAULT</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add bank form */}
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-3">
              {bankModal.banks.length > 0 ? 'Add Another Account' : 'Register Bank Account'}
            </p>
            <div className="space-y-3">
              <input
                placeholder="Bank Name (e.g. Republic Bank)"
                value={bankForm.bank_name}
                onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 font-mono outline-none focus:border-cyan-400/40 transition-all"
              />
              <input
                placeholder="Account Holder Name"
                value={bankForm.account_holder_name}
                onChange={(e) => setBankForm({ ...bankForm, account_holder_name: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 font-mono outline-none focus:border-cyan-400/40 transition-all"
              />
              <input
                placeholder="Account Number"
                value={bankForm.account_number}
                onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 font-mono outline-none focus:border-cyan-400/40 transition-all"
              />
              <select
                value={bankForm.account_type}
                onChange={(e) => setBankForm({ ...bankForm, account_type: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono outline-none focus:border-cyan-400/40 transition-all"
              >
                <option value="savings">Savings</option>
                <option value="checking">Checking</option>
              </select>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setBankModal({ ...bankModal, open: false })}
                className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/40 text-xs font-black uppercase tracking-widest hover:text-white transition-all"
              >
                Close
              </button>
              <button
                onClick={saveBank}
                disabled={savingBank || !bankForm.bank_name || !bankForm.account_holder_name || !bankForm.account_number}
                className="flex-1 py-3 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 transition-all disabled:opacity-50"
              >
                {savingBank ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, icon, isHighlight }: { title: string; value: string; icon: React.ReactNode; isHighlight?: boolean }) => (
  <div className={`p-6 rounded-[1.5rem] border transition-all ${
    isHighlight
      ? 'bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border-cyan-500/30 shadow-[0_0_30px_rgba(0,242,255,0.1)]'
      : 'bg-white/5 border-white/10 hover:border-white/20'
  }`}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{title}</span>
      <div className={`p-2 rounded-xl ${isHighlight ? 'bg-cyan-500/20' : 'bg-white/5'}`}>{icon}</div>
    </div>
    <p className="text-2xl font-black text-white">{value}</p>
  </div>
);
