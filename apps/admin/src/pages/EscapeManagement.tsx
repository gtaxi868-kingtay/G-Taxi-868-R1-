import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Plane, Users, ChevronRight, Clock, AlertTriangle, DollarSign,
  CheckCircle, XCircle, RefreshCw, Ban, Send, MessageSquare,
  ArrowLeft,
} from 'lucide-react';

function fmtTTD(cents: number) {
  return `TTD $${(cents / 100).toLocaleString('en-TT', { minimumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('en-TT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type PackageView = {
  id: string;
  package_name: string;
  tagline: string | null;
  cover_image_url: string | null;
  price_per_person_cents: number;
  max_total_guests: number | null;
  allocated_guests: number;
  confirmed_guests: number;
  min_guests_threshold: number | null;
  charge_deadline: string | null;
  charter_reference: string | null;
  is_active: boolean;
  auto_book_enabled: boolean | null;
  amadeus_booked_at: string | null;
  created_at: string;
};

type Participant = {
  id: string;
  rider_id: string;
  status: string;
  party_size: number;
  paid_cents: number;
  joined_at: string;
  charged_at: string | null;
  confirmed_at: string | null;
};

type Alert = {
  id: string;
  alert_type: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
};

export function EscapeManagement() {
  const [packages, setPackages] = useState<PackageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState<PackageView | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actionMsg, setActionMsg] = useState('');
  const [acting, setActing] = useState(false);
  const [delayMsg, setDelayMsg] = useState('');
  const [bookingRef, setBookingRef] = useState('');

  const loadPackages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('escape_packages')
      .select('*')
      .order('created_at', { ascending: false });
    setPackages(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);

  const selectPackage = async (pkg: PackageView) => {
    setSelectedPkg(pkg);
    setActionMsg('');
    setDelayMsg('');
    setBookingRef('');

    const { data: pData } = await supabase
      .from('escape_group_participants')
      .select('*')
      .eq('package_id', pkg.id)
      .order('joined_at', { ascending: false });
    setParticipants(pData || []);

    const { data: aData } = await supabase
      .from('group_booking_alerts')
      .select('*')
      .eq('package_id', pkg.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setAlerts(aData || []);
  };

  const doAction = async (action: string) => {
    setActing(true);
    try {
      const { error } = await supabase.rpc('admin_escape_action', {
        p_package_id: selectedPkg!.id,
        p_action: action,
        p_booking_ref: bookingRef || null,
        p_message: delayMsg || null,
      });
      if (error) {
        setActionMsg(`Error: ${error.message}`);
      } else {
        setActionMsg(`Action "${action}" completed`);
        selectPackage(selectedPkg!);
        loadPackages();
      }
    } catch (err: any) {
      setActionMsg(`Error: ${err.message}`);
    }
    setActing(false);
  };

  const capacityPct = (pkg: PackageView) => {
    if (!pkg.max_total_guests) return 0;
    return Math.round((pkg.allocated_guests / pkg.max_total_guests) * 100);
  };

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      intent_pending: 'text-yellow-400',
      payment_pending: 'text-orange-400',
      confirmed: 'text-green-400',
      passport_pending: 'text-blue-400',
      travel_ready: 'text-cyan-400',
      cancelled: 'text-red-400',
      refunded: 'text-gray-400',
    };
    return map[status] || 'text-white/40';
  };

  if (selectedPkg) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedPkg(null)} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors">
          <ArrowLeft size={16} />
          <span className="text-xs font-black uppercase tracking-widest">Back to all packages</span>
        </button>

        <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-black text-white">{selectedPkg.package_name}</h3>
              {selectedPkg.tagline && <p className="text-sm text-white/40 mt-1">{selectedPkg.tagline}</p>}
              <div className="flex items-center gap-4 mt-3">
                <span className="text-sm text-cyan-400 font-bold">{fmtTTD(selectedPkg.price_per_person_cents)} / pax</span>
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${selectedPkg.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {selectedPkg.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mt-6">
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Allocated</p>
              <p className="text-2xl font-black text-white mt-1">{selectedPkg.allocated_guests}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Confirmed</p>
              <p className="text-2xl font-black text-green-400 mt-1">{selectedPkg.confirmed_guests}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Threshold</p>
              <p className="text-2xl font-black text-cyan-400 mt-1">{selectedPkg.min_guests_threshold || '-'}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/30">Capacity</p>
              <p className="text-2xl font-black text-white mt-1">{selectedPkg.max_total_guests || '∞'}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          {selectedPkg.charter_reference && (
            <div className="flex-1 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl p-4">
              <p className="text-xs font-black text-cyan-400 uppercase tracking-widest">Charter Reference</p>
              <p className="text-sm font-mono text-cyan-300 mt-1">{selectedPkg.charter_reference}</p>
            </div>
          )}
          <div className="flex-1 bg-white/5 rounded-2xl border border-white/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black text-white uppercase tracking-widest">Auto Book</p>
                <p className="text-sm text-white/40 mt-1">
                  {selectedPkg.auto_book_enabled ? 'Seats booked automatically at threshold' : 'Admin must book manually'}
                </p>
              </div>
              <button
                onClick={async () => {
                  setActing(true);
                  await supabase.from('escape_packages').update({ auto_book_enabled: !selectedPkg.auto_book_enabled }).eq('id', selectedPkg.id);
                  selectPackage({ ...selectedPkg, auto_book_enabled: !selectedPkg.auto_book_enabled });
                  loadPackages();
                  setActing(false);
                }}
                disabled={acting}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  selectedPkg.auto_book_enabled
                    ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                    : 'bg-white/5 border border-white/10 text-white/40'
                }`}
              >
                {selectedPkg.auto_book_enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
          <h4 className="text-sm font-black text-white uppercase tracking-widest mb-4">Admin Actions</h4>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={bookingRef}
              onChange={(e) => setBookingRef(e.target.value)}
              placeholder="Booking ref (confirm only)"
              className="w-full sm:w-64 px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-white/20"
            />
            <button
              onClick={() => doAction('confirm')}
              disabled={acting}
              className="px-6 py-3 bg-cyan-500/20 border border-cyan-500/40 rounded-xl text-cyan-400 text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 flex items-center gap-2"
            >
              <CheckCircle size={14} /> Confirm
            </button>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={delayMsg}
                onChange={(e) => setDelayMsg(e.target.value)}
                placeholder="Delay message..."
                className="w-48 px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder-white/20"
              />
              <button
                onClick={() => doAction('delay')}
                disabled={acting}
                className="px-6 py-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl text-yellow-400 text-xs font-black uppercase tracking-widest hover:bg-yellow-500/30 flex items-center gap-2"
              >
                <Clock size={14} /> Delay
              </button>
            </div>
            <button
              onClick={() => { if (confirm('Refund ALL participants? This cannot be undone.')) doAction('refund_all'); }}
              disabled={acting}
              className="px-6 py-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-xs font-black uppercase tracking-widest hover:bg-red-500/30 flex items-center gap-2"
            >
              <Ban size={14} /> Refund All
            </button>
          </div>
          {actionMsg && (
            <p className="mt-3 text-sm font-mono text-white/60">{actionMsg}</p>
          )}
        </div>

        <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
          <h4 className="text-sm font-black text-white uppercase tracking-widest mb-4">Participants ({participants.length})</h4>
          {participants.length === 0 ? (
            <p className="text-sm text-white/30">No participants yet</p>
          ) : (
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5">
                  <div className="flex items-center gap-3">
                    <Users size={14} className="text-white/30" />
                    <div>
                      <p className="text-sm font-mono text-white/60">{p.rider_id.slice(0, 8)}...</p>
                      <p className="text-[10px] text-white/30">Party: {p.party_size}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-bold uppercase ${statusColor(p.status)}`}>{p.status.replace('_', ' ')}</span>
                    {p.paid_cents > 0 && <span className="text-xs text-green-400">{fmtTTD(p.paid_cents)}</span>}
                    <span className="text-[10px] text-white/20">{fmtDate(p.joined_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
          <h4 className="text-sm font-black text-white uppercase tracking-widest mb-4">Alerts ({alerts.length})</h4>
          {alerts.length === 0 ? (
            <p className="text-sm text-white/30">No alerts</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
                  <AlertTriangle size={14} className="text-yellow-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-white/80">{a.message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-bold uppercase text-white/30">{a.alert_type.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-white/20">{fmtDatetime(a.created_at)}</span>
                      {a.acknowledged && <span className="text-[10px] text-green-400">Acknowledged</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/40">Manage group-pool escape packages — demand aggregation, participant tracking, charter booking.</p>
        </div>
        <button onClick={loadPackages} disabled={loading} className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 flex items-center gap-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : packages.length === 0 ? (
        <div className="bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
          <Plane size={40} className="text-white/10 mx-auto mb-4" />
          <p className="text-lg font-black text-white/40">No escape packages yet</p>
          <p className="text-sm text-white/20 mt-1">Create a package in the database to start aggregating demand.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {packages.map((pkg) => {
            const pct = capacityPct(pkg);
            const ready = pkg.min_guests_threshold && pkg.allocated_guests >= pkg.min_guests_threshold;
            return (
              <button
                key={pkg.id}
                onClick={() => selectPackage(pkg)}
                className="w-full text-left bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 p-6 transition-all group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-black text-white">{pkg.package_name}</h3>
                      {ready && (
                        <span className="text-[10px] font-black text-green-400 bg-green-500/20 px-3 py-1 rounded-full uppercase tracking-widest">Ready</span>
                      )}
                    </div>
                    {pkg.tagline && <p className="text-sm text-white/40 mt-1">{pkg.tagline}</p>}
                    <div className="flex items-center gap-6 mt-3">
                      <span className="text-sm font-bold text-cyan-400">{fmtTTD(pkg.price_per_person_cents)}</span>
                      <span className="flex items-center gap-1 text-sm text-white/60">
                        <Users size={14} />
                        {pkg.allocated_guests} / {pkg.max_total_guests || '∞'}
                      </span>
                      {pkg.min_guests_threshold && (
                        <span className="flex items-center gap-1 text-sm text-yellow-400/60">
                          <AlertTriangle size={14} />
                          Min: {pkg.min_guests_threshold}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-sm text-green-400/60">
                        <CheckCircle size={14} />
                        {pkg.confirmed_guests} confirmed
                      </span>
                    </div>
                    {pkg.max_total_guests && (
                      <div className="w-full bg-white/5 rounded-full h-1.5 mt-3">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <ChevronRight size={20} className="text-white/20 group-hover:text-white/60 transition-colors ml-4 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
