import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Shield, ShieldCheck, ShieldX, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, ExternalLink, CalendarDays,
  FileText, Image as ImageIcon, Loader2, Search,
  Clock, AlertTriangle, Filter,
} from 'lucide-react';

interface ComplianceQueueItem {
  id: string;
  driver_id: string;
  document_type: string;
  document_url: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  drivers: {
    id: string;
    user_id: string;
    insurance_expires_at: string | null;
    profiles: { full_name: string; email: string; phone: string } | null;
  } | null;
}

interface ReviewLog {
  id: string;
  driver_id: string;
  document_type: string;
  status: 'approved' | 'rejected';
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  drivers: { profiles: { full_name: string } | null } | null;
}

function fmtTTD(cents: number) {
  return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  insurance: 'Insurance Certificate',
  license: "Driver's License",
  registration: 'Vehicle Registration',
  psv_badge: 'PSV Badge',
};

const DOC_TYPE_COLORS: Record<string, string> = {
  insurance: 'from-cyan-500/10 to-transparent border-cyan-500/20',
  license: 'from-purple-500/10 to-transparent border-purple-500/20',
  registration: 'from-green-500/10 to-transparent border-green-500/20',
  psv_badge: 'from-amber-500/10 to-transparent border-amber-500/20',
};

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;

export function ComplianceReview() {
  const [items, setItems] = useState<ComplianceQueueItem[]>([]);
  const [reviewLog, setReviewLog] = useState<ReviewLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expiredId, setExpiredId] = useState<string | null>(null);
  const [dateInputs, setDateInputs] = useState<Record<string, string>>({});
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [tab, setTab] = useState<'queue' | 'log'>('queue');
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const [queueRes, logRes] = await Promise.all([
        supabase
          .from('compliance_queue')
          .select(`
            *,
            drivers!inner(
              id, user_id, insurance_expires_at,
              profiles!inner(full_name, email, phone)
            )
          `)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('compliance_queue')
          .select(`
            id, driver_id, document_type, status, notes, submitted_at, reviewed_at,
            drivers!inner(profiles!inner(full_name))
          `)
          .neq('status', 'pending')
          .order('reviewed_at', { ascending: false })
          .limit(50),
      ]);
      if (queueRes.error) throw queueRes.error;
      setItems((queueRes.data as unknown as ComplianceQueueItem[]) || []);
      setReviewLog((logRes.data as unknown as ReviewLog[]) || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load compliance data');
      console.error('[ComplianceReview] load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleVerify = async (itemId: string, driverId: string) => {
    const expiresAt = dateInputs[itemId];
    if (!expiresAt) {
      alert('Enter an insurance expiry date before verifying.');
      return;
    }
    setActionLoading(itemId);
    try {
      const { data, error } = await supabase.rpc('approve_compliance_document', {
        p_queue_id: itemId,
        p_driver_id: driverId,
        p_insurance_expires_at: expiresAt,
        p_notes: null,
      });
      if (error) throw error;
      if (data === false) {
        alert('RPC returned false — check permissions or document status.');
      }
      await loadData();
      setDateInputs((prev) => { const next = { ...prev }; delete next[itemId]; return next; });
    } catch (err: any) {
      alert('Verification failed: ' + (err.message || 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (itemId: string) => {
    if (!window.confirm('Reject this compliance document? The driver will be notified.')) return;
    setActionLoading(itemId);
    try {
      await supabase
        .from('compliance_queue')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', itemId);
      await loadData();
    } catch (err: any) {
      alert('Rejection failed: ' + (err.message || 'Unknown error'));
    } finally {
      setActionLoading(null);
    }
  };

  const filteredItems = items.filter((i) => filter === 'all' || i.status === filter);
  const pendingCount = items.filter((i) => i.status === 'pending').length;

  if (loading) {
    return (
      <div className="space-y-6 animate-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Loading compliance queue...</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 animate-pulse">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-white/10 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-32" />
                  <div className="h-3 bg-white/10 rounded w-24" />
                </div>
              </div>
              <div className="h-32 bg-white/5 rounded-2xl mb-4" />
              <div className="h-10 bg-white/5 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-in">
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={loadData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">COMPLIANCE REVIEW</h2>
          <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">
            Driver Insurance // Certificates // Document Verification
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest">
              <AlertTriangle size={12} />
              {pendingCount} pending
            </span>
          )}
          <button
            onClick={loadData}
            className="h-12 px-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center gap-3"
          >
            <Loader2 size={18} /> Refresh
          </button>
        </div>
      </div>

      {/* FILTER + VIEW TOGGLE */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="glass-tab">
          <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
            <FileText size={14} /> Queue
          </button>
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
            <Clock size={14} /> Review Log
          </button>
        </div>
        {tab === 'queue' && (
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-white/30" />
            {(['pending', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${
                  filter === f
                    ? 'bg-white/10 text-white border-white/20'
                    : 'text-white/30 border-white/5 hover:text-white/60'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'queue' && (
        <>
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <ShieldCheck className="text-white/10 mb-6" size={64} />
              <p className="text-white/40 text-sm font-black uppercase tracking-widest mb-2">All Clear</p>
              <p className="text-white/20 text-xs">No compliance documents awaiting review</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredItems.map((item) => {
                const driver = item.drivers;
                const profile = driver?.profiles;
                const isPending = item.status === 'pending';
                const isBusy = actionLoading === item.id;
                const docColor = DOC_TYPE_COLORS[item.document_type] || 'from-white/5 to-transparent border-white/10';
                return (
                  <div
                    key={item.id}
                    className={`bg-white/5 border rounded-[2.5rem] overflow-hidden transition-all duration-300 ${
                      isPending
                        ? 'border-amber-500/20 hover:border-amber-500/40 shadow-lg shadow-amber-500/5'
                        : item.status === 'approved'
                        ? 'border-green-500/20'
                        : 'border-red-500/20'
                    }`}
                  >
                    {/* surface-tension top specular */}
                    <div className="h-0.5 w-full bg-gradient-to-r from-white/10 via-white/5 to-transparent" />

                    <div className="p-6 sm:p-8">
                      {/* DRIVER INFO */}
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${docColor} border flex items-center justify-center`}>
                            {item.document_type === 'insurance' ? (
                              <Shield size={22} className="text-cyan-400" />
                            ) : (
                              <FileText size={22} className="text-purple-400" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-black text-white">
                              {profile?.full_name || 'Unknown Driver'}
                            </p>
                            <p className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">
                              {profile?.email || 'No email'}
                            </p>
                            {profile?.phone && (
                              <p className="text-[10px] text-white/20 mt-0.5 font-mono">{profile.phone}</p>
                            )}
                          </div>
                        </div>
                        <span
                          className={`text-[9px] font-black px-2.5 py-1 rounded-lg border uppercase tracking-widest whitespace-nowrap ${
                            isPending
                              ? 'text-amber-400 bg-amber-400/10 border-amber-500/20'
                              : item.status === 'approved'
                              ? 'text-green-400 bg-green-400/10 border-green-500/20'
                              : 'text-red-400 bg-red-400/10 border-red-500/20'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>

                      {/* DOCUMENT TYPE */}
                      <div className="flex items-center gap-2 mb-4">
                        <FileText size={12} className="text-white/30" />
                        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
                          {DOC_TYPE_LABELS[item.document_type] || item.document_type}
                        </span>
                        <span className="text-[9px] text-white/20 ml-auto font-mono">
                          {formatDate(item.submitted_at)}
                        </span>
                      </div>

                      {/* DOCUMENT PREVIEW */}
                      <div
                        className="relative bg-black/40 border border-white/5 rounded-2xl overflow-hidden mb-4 h-40 flex items-center justify-center cursor-pointer group"
                        onClick={() => {
                          const url = item.document_url.startsWith('http')
                            ? item.document_url
                            : `${SUPA_URL}/storage/v1/object/public/compliance_documents/${item.document_url}`;
                          setImagePreview(url);
                        }}
                      >
                        {item.document_url ? (
                          <>
                            <img
                              src={
                                item.document_url.startsWith('http')
                                  ? item.document_url
                                  : `${SUPA_URL}/storage/v1/object/public/compliance_documents/${item.document_url}`
                              }
                              alt="Document"
                              className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                (e.currentTarget.parentElement!.querySelector('.fallback-icon') as HTMLElement).style.display = 'flex';
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ExternalLink size={24} className="text-white" />
                            </div>
                          </>
                        ) : (
                          <div className="fallback-icon flex flex-col items-center gap-2">
                            <ImageIcon size={32} className="text-white/20" />
                            <span className="text-[10px] text-white/20">No preview</span>
                          </div>
                        )}
                      </div>

                      {/* INSURANCE EXPIRY */}
                      <div className="flex items-center gap-3 mb-5">
                        <CalendarDays size={14} className="text-white/30 shrink-0" />
                        <div className="flex-1">
                          <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">
                            Insurance Expires At
                          </label>
                          <input
                            type="date"
                            value={dateInputs[item.id] || ''}
                            onChange={(e) =>
                              setDateInputs((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            disabled={!isPending || isBusy}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500 outline-none transition-all disabled:opacity-40"
                            placeholder="yyyy-mm-dd"
                          />
                        </div>
                        {driver?.insurance_expires_at && (
                          <div className="text-right shrink-0">
                            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Current</p>
                            <p className="text-xs font-bold text-white/60">{formatDate(driver.insurance_expires_at)}</p>
                          </div>
                        )}
                      </div>

                      {/* EXPIRED WARNING */}
                      {driver?.insurance_expires_at && new Date(driver.insurance_expires_at) < new Date() && (
                        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl mb-5">
                          <AlertTriangle size={14} className="text-red-400 shrink-0" />
                          <span className="text-[10px] font-bold text-red-400">
                            Insurance expired — driver blocked from going online
                          </span>
                        </div>
                      )}

                      {/* ACTIONS */}
                      {isPending && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleVerify(item.id, driver?.id || '')}
                            disabled={isBusy}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500/15 text-green-400 border border-green-500/25 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-500/25 transition-all disabled:opacity-40"
                          >
                            {isBusy ? (
                              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <CheckCircle2 size={14} /> Verify Compliance
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleReject(item.id)}
                            disabled={isBusy}
                            className="px-4 py-3 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-40"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                      )}

                      {item.notes && (
                        <p className="mt-3 text-[10px] text-white/30 italic">{item.notes}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'log' && (
        <div className="bg-white/5 border border-white/10 rounded-[2.5rem] overflow-hidden">
          <div className="px-8 py-5 border-b border-white/5 flex items-center gap-3">
            <Clock size={14} className="text-white/30" />
            <h3 className="text-[10px] font-black text-white/40 uppercase tracking-widest">Verification History</h3>
          </div>
          {reviewLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Shield className="text-white/10 mb-4" size={40} />
              <p className="text-white/30 text-xs font-black uppercase tracking-widest">No review history</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {reviewLog.map((entry) => (
                <div key={entry.id} className="px-8 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                    entry.status === 'approved'
                      ? 'bg-green-500/10 border-green-500/20'
                      : 'bg-red-500/10 border-red-500/20'
                  }`}>
                    {entry.status === 'approved'
                      ? <CheckCircle2 size={14} className="text-green-400" />
                      : <XCircle size={14} className="text-red-400" />
                    }
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-white">
                      {entry.drivers?.profiles?.full_name || 'Unknown'} — {DOC_TYPE_LABELS[entry.document_type] || entry.document_type}
                    </p>
                    <p className="text-[10px] text-white/30 mt-0.5">
                      {formatDate(entry.submitted_at)} → {formatDate(entry.reviewed_at)}
                    </p>
                  </div>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest ${
                    entry.status === 'approved'
                      ? 'text-green-400 bg-green-400/10 border-green-500/20'
                      : 'text-red-400 bg-red-400/10 border-red-500/20'
                  }`}>
                    {entry.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* IMAGE PREVIEW MODAL */}
      {imagePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
          style={{ background: 'rgba(5,5,10,0.92)', backdropFilter: 'blur(24px)' }}
          onClick={() => setImagePreview(null)}
        >
          <div className="relative max-w-3xl w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-12 right-0 p-2 text-white/60 hover:text-white transition-colors"
            >
              <XCircle size={24} />
            </button>
            <img
              src={imagePreview}
              alt="Document preview"
              className="w-full h-auto rounded-2xl border border-white/10 shadow-2xl"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
