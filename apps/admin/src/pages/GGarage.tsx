import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '../lib/supabase';
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, Ban, Car, Loader2,
  CheckCircle2, XCircle, RefreshCw, Wrench,
} from 'lucide-react';

interface DriverRegistrationRow {
  id: string;
  name: string;
  plate_number: string | null;
  vehicle_model: string | null;
  registration_class: 'unverified' | 'H' | 'R' | 'private';
  registration_verified_at: string | null;
  status: string;
  registration_proof: { storage_path: string; status: string; created_at: string } | null;
}

interface GarageRequestRow {
  id: string;
  source: 'local_dealer' | 'platform_import';
  min_daily_contribution_cents: number;
  max_daily_contribution_cents: number;
  requested_daily_contribution_cents: number;
  platform_match_pct: number;
  h_registration_opt_in: boolean;
  status: string;
  created_at: string;
  driver: { id: string; name: string; plate_number: string; registration_class: string; rank: string } | null;
  vehicle_class: { key: string; label: string; category: string; landed_cost_cents: number | null; cost_source: string | null } | null;
}

function fmtTTD(cents: number) {
  return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 2 })}`;
}

const CLASS_BADGE: Record<string, string> = {
  H: 'bg-green-500/10 text-green-400 border-green-500/20',
  R: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  private: 'bg-red-500/10 text-red-400 border-red-500/20',
  unverified: 'bg-white/5 text-white/40 border-white/10',
};

export function GGarage() {
  const [subTab, setSubTab] = useState<'registration' | 'requests'>('registration');

  const [drivers, setDrivers] = useState<DriverRegistrationRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);

  const [requests, setRequests] = useState<GarageRequestRow[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    try {
      const res = await adminFetch('admin', { action: 'get_registration_audit' });
      if (res?.success) {
        setDrivers(res.drivers || []);
        setSummary(res.summary || null);
      }
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await adminFetch('admin', { action: 'get_garage_requests' });
      if (res?.success) setRequests(res.requests || []);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadDrivers();
    loadRequests();
  }, [loadDrivers, loadRequests]);

  const setRegistrationClass = async (driverId: string, registration_class: string) => {
    setBusyDriverId(driverId);
    try {
      const res = await adminFetch('admin', { action: 'set_driver_registration', driver_id: driverId, registration_class });
      if (!res?.success) throw new Error(res?.error || 'Update failed');
      await loadDrivers();
    } catch (err: any) {
      alert(err.message || 'Update failed');
    } finally {
      setBusyDriverId(null);
    }
  };

  const decideRequest = async (requestId: string, decision: 'approved' | 'rejected') => {
    const reason = decision === 'rejected' ? window.prompt('Reason for rejecting (shown to the driver):') : null;
    if (decision === 'rejected' && reason === null) return; // cancelled prompt
    setBusyRequestId(requestId);
    try {
      const res = await adminFetch('admin', { action: 'decide_garage_request', request_id: requestId, decision, reason });
      if (!res?.success) throw new Error(res?.error || 'Decision failed');
      await loadRequests();
    } catch (err: any) {
      alert(err.message || 'Decision failed');
    } finally {
      setBusyRequestId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">G GARAGE</h2>
          <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Registration Compliance // Driver Vehicle Requests</p>
        </div>
        <button
          onClick={() => { loadDrivers(); loadRequests(); }}
          className="btn-press h-12 px-6 rounded-xl bg-white/5 border border-white/10 text-white/50 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="flex gap-2 bg-white/5 rounded-2xl p-1.5 w-fit">
        <button
          onClick={() => setSubTab('registration')}
          className={`btn-press px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${subTab === 'registration' ? 'bg-amber-500/20 text-amber-400' : 'text-white/30 hover:text-white/50'}`}
        >
          <ShieldAlert size={14} className="inline mr-2" />
          Registration ('H' Plate)
          {summary && (summary.unverified > 0 || summary.private > 0) && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[9px]">{summary.unverified + summary.private}</span>
          )}
        </button>
        <button
          onClick={() => setSubTab('requests')}
          className={`btn-press px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${subTab === 'requests' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/30 hover:text-white/50'}`}
        >
          <Car size={14} className="inline mr-2" />
          Vehicle Requests
          {requests.filter((r) => r.status === 'pending').length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-[9px]">
              {requests.filter((r) => r.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {subTab === 'registration' && (
        <div className="space-y-6">
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mb-1">Unverified</p>
                <p className="text-2xl font-black text-white/60">{summary.unverified}</p>
              </div>
              <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-5">
                <p className="text-[9px] font-black text-green-400/60 uppercase tracking-widest mb-1">H (For-Hire)</p>
                <p className="text-2xl font-black text-green-400">{summary.H}</p>
              </div>
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
                <p className="text-[9px] font-black text-cyan-400/60 uppercase tracking-widest mb-1">R (Rental)</p>
                <p className="text-2xl font-black text-cyan-400">{summary.R}</p>
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                <p className="text-[9px] font-black text-red-400/60 uppercase tracking-widest mb-1">Private (Non-Compliant)</p>
                <p className="text-2xl font-black text-red-400">{summary.private}</p>
              </div>
            </div>
          )}

          {loadingDrivers ? (
            <div className="py-32 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={32} /></div>
          ) : (
            <div className="rounded-[1.5rem] border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/[0.02] border-b border-white/10">
                    <th className="px-6 py-4 text-left text-[10px] font-black text-white/20 uppercase tracking-widest">Driver</th>
                    <th className="px-6 py-4 text-left text-[10px] font-black text-white/20 uppercase tracking-widest">Plate</th>
                    <th className="px-6 py-4 text-left text-[10px] font-black text-white/20 uppercase tracking-widest">Proof Doc</th>
                    <th className="px-6 py-4 text-left text-[10px] font-black text-white/20 uppercase tracking-widest">Class</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-white/20 uppercase tracking-widest">Set Class</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-6 py-4 text-white/70 font-medium">{d.name}</td>
                      <td className="px-6 py-4 font-mono text-white/50 text-xs">{d.plate_number || '—'}</td>
                      <td className="px-6 py-4 text-xs">
                        {d.registration_proof ? (
                          <span className="text-white/50">{d.registration_proof.status} · {new Date(d.registration_proof.created_at).toLocaleDateString()}</span>
                        ) : (
                          <span className="text-white/20">No document uploaded</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${CLASS_BADGE[d.registration_class]}`}>
                          {d.registration_class}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          {(['H', 'R', 'private', 'unverified'] as const).map((c) => (
                            <button
                              key={c}
                              disabled={busyDriverId === d.id || d.registration_class === c}
                              onClick={() => setRegistrationClass(d.id, c)}
                              className={`btn-press text-[9px] font-black px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-30 ${CLASS_BADGE[c]} hover:brightness-125`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {drivers.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-16 text-center text-white/30">No drivers found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === 'requests' && (
        <div className="space-y-4">
          {loadingRequests ? (
            <div className="py-32 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={32} /></div>
          ) : requests.length === 0 ? (
            <div className="py-32 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
              <Wrench size={48} className="mx-auto mb-4 text-white/20" />
              <p className="text-white/60 font-black text-xs">No G Garage requests yet</p>
            </div>
          ) : (
            requests.map((r) => (
              <div key={r.id} className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-6">
                <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <h3 className="text-white font-black text-sm">{r.driver?.name || 'Unknown driver'}</h3>
                    <p className="text-[10px] font-mono text-white/30 mt-0.5">
                      {r.vehicle_class?.label || r.vehicle_class?.key} · {r.source === 'local_dealer' ? 'Local dealer' : 'Platform import'} · {new Date(r.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.driver && (
                      <span className={`px-2.5 py-1 rounded-full border text-[9px] font-black uppercase ${CLASS_BADGE[r.driver.registration_class]}`}>
                        {r.driver.registration_class}
                      </span>
                    )}
                    <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${
                      r.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : r.status === 'approved' || r.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>{r.status}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs">
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Requested/day</p>
                    <p className="text-white/70 font-bold">{fmtTTD(r.requested_daily_contribution_cents)}</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Range</p>
                    <p className="text-white/70 font-bold">{fmtTTD(r.min_daily_contribution_cents)} – {fmtTTD(r.max_daily_contribution_cents)}</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">Platform match</p>
                    <p className="text-white/70 font-bold">{r.platform_match_pct}%</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[9px] text-white/20 uppercase font-black mb-1">'H' opt-in</p>
                    <p className="text-white/70 font-bold">{r.h_registration_opt_in ? 'Yes' : 'No'}</p>
                  </div>
                </div>

                {r.vehicle_class?.landed_cost_cents != null ? (
                  <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 mb-4 text-xs">
                    <p className="text-[9px] text-cyan-400/60 uppercase font-black mb-1">Real payback estimate</p>
                    <p className="text-white/70 font-bold">
                      {fmtTTD(r.vehicle_class.landed_cost_cents)} landed cost ÷ {fmtTTD(r.requested_daily_contribution_cents)}/day ={' '}
                      {Math.round(r.vehicle_class.landed_cost_cents / r.requested_daily_contribution_cents)} days from this driver's own contribution alone
                      ({(r.vehicle_class.landed_cost_cents / r.requested_daily_contribution_cents / 30).toFixed(1)} months)
                    </p>
                    <p className="text-[9px] text-white/30 mt-1">Cost source: {r.vehicle_class.cost_source}</p>
                  </div>
                ) : (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mb-4 text-xs">
                    <p className="text-amber-400 font-bold">No real landed cost on file for "{r.vehicle_class?.label}"</p>
                    <p className="text-white/40 text-[10px] mt-1">Enter a real quote in Pricing → Vehicle Classes before approving — otherwise this is a blind approval.</p>
                  </div>
                )}

                {r.status === 'pending' && (
                  <div className="flex gap-3">
                    <button
                      disabled={busyRequestId === r.id}
                      onClick={() => decideRequest(r.id, 'approved')}
                      className="btn-press flex-1 h-11 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-black text-[10px] uppercase tracking-widest hover:bg-green-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      {busyRequestId === r.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
                    </button>
                    <button
                      disabled={busyRequestId === r.id}
                      onClick={() => decideRequest(r.id, 'rejected')}
                      className="btn-press flex-1 h-11 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-black text-[10px] uppercase tracking-widest hover:bg-red-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
