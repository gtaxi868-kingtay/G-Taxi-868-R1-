import { useEffect, useState, useCallback } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import {
  Plane, Users, ChevronRight, Clock, AlertTriangle, DollarSign,
  CheckCircle, XCircle, RefreshCw, Ban, Send, MessageSquare,
  ArrowLeft, Car,
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

const LField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-[9px] font-bold text-white/30 uppercase tracking-widest mb-1.5">{label}</label>
    {children}
  </div>
);

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
  flight_block_id: string;
  // Live-system fields (flight_blocks/package_reservations) -- the group
  // block-hold state a real operator needs to actually manage the block,
  // distinct from the legacy escape_group_participants fields above.
  flight_blocks: {
    fill_deadline_date: string | null;
    locked_group_size: number | null;
    locked_discount_percent: number | null;
    confirming_provider: string | null;
    status: string;
    departure_time: string;
  } | null;
  live_headcount?: number;
};

type GroupDiscountTier = { min_group_size: number; discount_percent: number };
type CarrierPolicy = { carrier_name: string; name_submission_deadline_days: number };

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

// Ground-transit rides created by execute_escape_group_confirmation for the
// LIVE booking system (flight_blocks/package_reservations) — a separate
// system from the escape_packages/escape_group_participants rows below,
// which is the older, disconnected one this page otherwise manages. Kept
// on this page because "escape ops" is the natural home, not because the
// two systems share data.
type TransferRide = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  total_fare_cents: number;
  scheduled_for: string | null;
  notes: string | null;
  reservation: { reservation_id: string; booking_ref: string | null; leg: string } | null;
};

const LEG_LABELS: Record<string, string> = {
  trinidad_transfer_ride_id: 'Outbound: Home → Airport',
  destination_transfer_ride_id: 'Outbound: Airport → Villa',
  destination_return_ride_id: 'Return: Villa → Airport',
  trinidad_return_ride_id: 'Return: Airport → Home',
};

type ZoneRate = {
  id: string;
  zone_name: string;
  description: string | null;
  payout_cents: number;
  typical_distance_km: number | null;
  is_active: boolean;
};

type LodgingNode = {
  id: string;
  merchant_id: string;
  name: string;
  destination_code: string;
  location_zone: string;
  nights: number;
  base_price_per_night_cents: number;
  max_guests: number;
  is_active: boolean;
  lat: number | null;
  lng: number | null;
  description: string | null;
  cover_image_url: string | null;
  requires_verification?: boolean;
  owner_name: string | null;
  owner_phone: string | null;
  owner_whatsapp: string | null;
  owner_email: string | null;
};

type MerchantOption = { id: string; name: string };

export function EscapeManagement() {
  const [tab, setTab] = useState<'packages' | 'transfers' | 'zones' | 'lodging' | 'author'>('packages');
  const [packages, setPackages] = useState<PackageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState<PackageView | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actionMsg, setActionMsg] = useState('');
  const [acting, setActing] = useState(false);
  const [delayMsg, setDelayMsg] = useState('');
  const [bookingRef, setBookingRef] = useState('');

  const [groupDiscountTiers, setGroupDiscountTiers] = useState<GroupDiscountTier[]>([]);
  const [carrierPolicies, setCarrierPolicies] = useState<CarrierPolicy[]>([]);

  const [transferRides, setTransferRides] = useState<TransferRide[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);

  const [zones, setZones] = useState<ZoneRate[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneRate | null>(null);

  const [lodgingNodes, setLodgingNodes] = useState<LodgingNode[]>([]);
  const [lodgingLoading, setLodgingLoading] = useState(false);
  const [editingLodging, setEditingLodging] = useState<Partial<LodgingNode> | null>(null);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [draftingCopy, setDraftingCopy] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [candidateSubmitting, setCandidateSubmitting] = useState(false);
  const [candidateMsg, setCandidateMsg] = useState('');

  const [authorForm, setAuthorForm] = useState({
    package_name: '', origin_code: 'POS', destination_code: '', destination_name: '',
    departure_time: '', return_time: '', total_capacity_seats: '20', tipping_point_seats: '4',
    lodging_node_id: '', driver_origin_zone: '', driver_destination_zone: '',
    price_per_person_cents: '', platform_margin_cents: '6000', max_total_guests: '20',
  });
  const [authorSubmitting, setAuthorSubmitting] = useState(false);
  const [authorMsg, setAuthorMsg] = useState('');

  const loadPackages = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('escape_packages')
      .select('*, flight_blocks(fill_deadline_date, locked_group_size, locked_discount_percent, confirming_provider, status, departure_time)')
      .order('created_at', { ascending: false });

    const rows = (data || []) as PackageView[];

    // Live headcount comes from package_reservations (the system riders
    // actually book through), not the legacy allocated_guests/confirmed_guests
    // fields above -- those track escape_group_participants, which real
    // riders never touch.
    const flightBlockIds = rows.map((p) => p.flight_block_id).filter(Boolean);
    if (flightBlockIds.length) {
      const { data: reservations } = await supabase
        .from('package_reservations')
        .select('flight_block_id, guest_count')
        .in('flight_block_id', flightBlockIds)
        .in('status', ['CAPTURED', 'CONFIRMED']);

      const headcountByBlock = new Map<string, number>();
      for (const r of reservations || []) {
        headcountByBlock.set(r.flight_block_id, (headcountByBlock.get(r.flight_block_id) || 0) + (r.guest_count || 0));
      }
      for (const p of rows) {
        p.live_headcount = headcountByBlock.get(p.flight_block_id) || 0;
      }
    }

    setPackages(rows);
    setLoading(false);
  }, []);

  const loadPricingConfig = useCallback(async () => {
    const { data: tiers } = await supabase.from('group_discount_tiers').select('*').order('min_group_size');
    setGroupDiscountTiers(tiers || []);
    const { data: policies } = await supabase.from('carrier_policies').select('carrier_name, name_submission_deadline_days');
    setCarrierPolicies(policies || []);
  }, []);

  const loadTransferRides = useCallback(async () => {
    setTransfersLoading(true);
    try {
      const { rides } = await adminFetch('admin', { action: 'list_escape_transfer_rides' });
      setTransferRides(rides || []);
    } catch (err) {
      console.error('[EscapeManagement] loadTransferRides error:', err);
    } finally {
      setTransfersLoading(false);
    }
  }, []);

  const loadZones = useCallback(async () => {
    setZonesLoading(true);
    const { data } = await supabase.from('driver_zone_rates').select('*').order('zone_name');
    setZones(data || []);
    setZonesLoading(false);
  }, []);

  const loadLodging = useCallback(async () => {
    setLodgingLoading(true);
    const { data } = await supabase.from('lodging_nodes').select('*').order('name');
    setLodgingNodes(data || []);
    const { data: merch } = await supabase.from('merchants').select('id, name').eq('category', 'hotel').order('name');
    setMerchants(merch || []);
    setLodgingLoading(false);
  }, []);

  useEffect(() => { loadPackages(); loadPricingConfig(); }, [loadPackages, loadPricingConfig]);
  useEffect(() => { if (tab === 'transfers') loadTransferRides(); }, [tab, loadTransferRides]);
  useEffect(() => { if (tab === 'zones') loadZones(); }, [tab, loadZones]);
  useEffect(() => { if (tab === 'lodging' || tab === 'author') loadLodging(); }, [tab, loadLodging]);
  useEffect(() => { if (tab === 'author' && zones.length === 0) loadZones(); }, [tab]);

  const saveZone = async (zone: ZoneRate) => {
    const { error } = await supabase.from('driver_zone_rates').update({
      description: zone.description, payout_cents: zone.payout_cents,
      typical_distance_km: zone.typical_distance_km, is_active: zone.is_active,
    }).eq('id', zone.id);
    if (error) { alert(error.message); return; }
    setEditingZone(null);
    loadZones();
  };

  const saveLodging = async (node: Partial<LodgingNode>) => {
    if (!node.name || !node.merchant_id || !node.destination_code || !node.location_zone
        || !node.nights || !node.base_price_per_night_cents || !node.max_guests) {
      alert('Name, merchant, destination code, zone, nights, nightly rate, and max guests are required');
      return;
    }
    const payload = {
      name: node.name, merchant_id: node.merchant_id, destination_code: node.destination_code,
      location_zone: node.location_zone, nights: node.nights,
      base_price_per_night_cents: node.base_price_per_night_cents, max_guests: node.max_guests,
      is_active: node.is_active ?? true, lat: node.lat ?? null, lng: node.lng ?? null,
      description: node.description ?? null, cover_image_url: node.cover_image_url ?? null,
      owner_name: node.owner_name ?? null, owner_phone: node.owner_phone ?? null,
      owner_whatsapp: node.owner_whatsapp ?? null, owner_email: node.owner_email ?? null,
    };
    const { error } = node.id
      ? await supabase.from('lodging_nodes').update(payload).eq('id', node.id)
      : await supabase.from('lodging_nodes').insert(payload);
    if (error) { alert(error.message); return; }
    setEditingLodging(null);
    loadLodging();
  };

  // G Co-Host: on-demand AI copy draft — admin reviews/edits the returned
  // text before Save, same control point as every other field on this form.
  const draftCopy = async () => {
    if (!editingLodging?.name || !editingLodging?.destination_code) {
      alert('Name and destination code are required before drafting a description');
      return;
    }
    setDraftingCopy(true);
    try {
      const res = await adminFetch('admin', {
        action: 'draft_lodging_copy',
        name: editingLodging.name, destination_code: editingLodging.destination_code,
        location_zone: editingLodging.location_zone, max_guests: editingLodging.max_guests,
        nights: editingLodging.nights,
      });
      if (!res?.success) { alert(res?.error || 'AI draft failed'); return; }
      setEditingLodging({ ...editingLodging, description: res.draft });
    } catch (err: any) {
      alert(err.message || 'AI draft failed');
    } finally {
      setDraftingCopy(false);
    }
  };

  // G Co-Host: photo upload to the migration-tracked lodging-photos bucket
  // (public read, admin-only write per storage.objects RLS).
  const uploadPhoto = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('lodging-photos').upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('lodging-photos').getPublicUrl(path);
      setEditingLodging((cur) => cur ? { ...cur, cover_image_url: data.publicUrl } : cur);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // G Co-Host: commander/admin-sourced property — files a grid_candidate
  // proposal into the G approvals inbox instead of writing lodging_nodes
  // directly, since these are less-vetted than an admin's own entry above.
  const submitCandidate = async (node: Partial<LodgingNode>) => {
    if (!node.name || !node.destination_code || !node.location_zone || !node.base_price_per_night_cents) {
      alert('Name, destination code, zone, and nightly rate are required');
      return;
    }
    setCandidateSubmitting(true);
    setCandidateMsg('');
    try {
      const res = await adminFetch('admin', {
        action: 'submit_lodging_candidate',
        candidate: {
          name: node.name, destination_code: node.destination_code, location_zone: node.location_zone,
          nights: node.nights, base_price_per_night_cents: node.base_price_per_night_cents,
          max_guests: node.max_guests, owner_name: node.owner_name, owner_phone: node.owner_phone,
          owner_whatsapp: node.owner_whatsapp, owner_email: node.owner_email, notes: node.description,
        },
      });
      if (!res?.success) throw new Error(res?.error || 'Failed to submit candidate');
      setCandidateMsg('Filed to G\'s approvals inbox — nothing goes live until an admin approves it there.');
      setTimeout(() => { setEditingLodging(null); setCandidateMsg(''); }, 2000);
    } catch (err: any) {
      setCandidateMsg(`Error: ${err.message}`);
    } finally {
      setCandidateSubmitting(false);
    }
  };

  // Creates flight_blocks then escape_packages — the two real cost-sourcing
  // triggers (sync_flight_block_real_cost, sync_escape_package_real_costs)
  // do the actual pricing from driver_zone_rates/lodging_nodes/escape_lane_
  // fare_baseline; this form just supplies the real identifiers they key on.
  // Sell price and platform margin are server-computed by
  // trg_sync_escape_package_sell_price (real cost total run through
  // calculate_escape_sell_price + pricing_rules) — never accepted from this
  // form, so they're intentionally not sent here.
  const submitAuthorPackage = async () => {
    setAuthorMsg('');
    const f = authorForm;
    if (!f.package_name || !f.destination_code || !f.destination_name || !f.departure_time
        || !f.lodging_node_id || !f.driver_origin_zone || !f.driver_destination_zone) {
      setAuthorMsg('All fields except return time are required');
      return;
    }
    setAuthorSubmitting(true);
    try {
      const { data: block, error: blockErr } = await supabase.from('flight_blocks').insert({
        origin_code: f.origin_code, destination_code: f.destination_code, destination_name: f.destination_name,
        departure_time: new Date(f.departure_time).toISOString(),
        return_time: f.return_time ? new Date(f.return_time).toISOString() : null,
        total_capacity_seats: Number(f.total_capacity_seats), allocated_seats: 0,
        tipping_point_seats: Number(f.tipping_point_seats), status: 'POOLING',
      }).select('id').single();
      if (blockErr) throw blockErr;

      const { error: pkgErr } = await supabase.from('escape_packages').insert({
        flight_block_id: block.id, lodging_node_id: f.lodging_node_id, package_name: f.package_name,
        driver_origin_zone: f.driver_origin_zone, driver_destination_zone: f.driver_destination_zone,
        max_total_guests: Number(f.max_total_guests),
        is_active: true,
      });
      if (pkgErr) throw pkgErr;

      setAuthorMsg('Package created — real driver/lodging/flight costs and sell price applied automatically.');
      setAuthorForm({ ...authorForm, package_name: '', destination_code: '', destination_name: '', departure_time: '', return_time: '' });
      loadPackages();
    } catch (err: any) {
      setAuthorMsg(`Error: ${err.message}`);
    } finally {
      setAuthorSubmitting(false);
    }
  };

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

  // Highest group_discount_tiers row the given headcount qualifies for --
  // mirrors calculate_escape_group_price's lookup, read from the real
  // config table rather than a hardcoded 7/10/16 ladder client-side.
  const projectedGroupDiscount = (headcount: number) => {
    const applicable = groupDiscountTiers.filter((t) => t.min_group_size <= headcount);
    if (!applicable.length) return 0;
    return Math.max(...applicable.map((t) => t.discount_percent));
  };

  const daysUntil = (dateStr: string | null) => {
    if (!dateStr) return null;
    const diffMs = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
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
        <div className="flex gap-2 p-1 bg-white/5 rounded-2xl border border-white/5 w-fit">
          <button
            onClick={() => setTab('packages')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'packages' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            <Plane size={12} /> Packages (legacy pool)
          </button>
          <button
            onClick={() => setTab('transfers')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'transfers' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            <Car size={12} /> Ground Transfers (live bookings)
          </button>
          <button
            onClick={() => setTab('zones')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'zones' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            <DollarSign size={12} /> Driver Zone Rates
          </button>
          <button
            onClick={() => setTab('lodging')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'lodging' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            <Users size={12} /> Lodging
          </button>
          <button
            onClick={() => setTab('author')}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === 'author' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}
          >
            <Send size={12} /> New Package
          </button>
        </div>
        {['packages', 'transfers', 'zones', 'lodging'].includes(tab) && (
          <button
            onClick={tab === 'packages' ? loadPackages : tab === 'transfers' ? loadTransferRides : tab === 'zones' ? loadZones : loadLodging}
            disabled={tab === 'packages' ? loading : tab === 'transfers' ? transfersLoading : tab === 'zones' ? zonesLoading : lodgingLoading}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 flex items-center gap-2"
          >
            <RefreshCw size={14} className="" /> Refresh
          </button>
        )}
      </div>

      {tab === 'zones' && (
        <div className="space-y-4">
          <p className="text-sm text-white/40">
            Real, distance-based payout rate per zone — this is the authoritative source for every G-Escape
            ground-transit driver cost. Editing a rate here changes what the next package created uses; it
            does not retroactively change already-confirmed bookings.
          </p>
          {zonesLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white/[0.02]">
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Zone</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Description</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Distance</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Payout</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Active</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Edit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {zones.map((z) => {
                      const isEditing = editingZone?.id === z.id;
                      return (
                        <tr key={z.id} className="hover:bg-white/[0.02]">
                          <td className="px-6 py-4 text-xs font-bold text-white/80 font-mono">{z.zone_name}</td>
                          <td className="px-6 py-4 text-xs text-white/50">
                            {isEditing ? (
                              <input value={editingZone!.description ?? ''} onChange={(e) => setEditingZone({ ...editingZone!, description: e.target.value })} className="w-full px-2 py-1 bg-black/40 border border-white/10 rounded-lg text-white" />
                            ) : z.description}
                          </td>
                          <td className="px-6 py-4 text-xs text-white/50">{z.typical_distance_km ?? '—'} km</td>
                          <td className="px-6 py-4 text-xs font-black text-white">
                            {isEditing ? (
                              <input type="number" value={(editingZone!.payout_cents / 100).toFixed(2)} onChange={(e) => setEditingZone({ ...editingZone!, payout_cents: Math.round(Number(e.target.value) * 100) })} className="w-24 px-2 py-1 bg-black/40 border border-white/10 rounded-lg text-white" />
                            ) : fmtTTD(z.payout_cents)}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[9px] font-black px-2 py-1 rounded-md border ${z.is_active ? 'text-green-400 bg-green-400/10 border-green-500/20' : 'text-white/30 bg-white/5 border-white/10'}`}>
                              {z.is_active ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {isEditing ? (
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => saveZone(editingZone!)} className="text-[10px] font-black text-green-400 uppercase">Save</button>
                                <button onClick={() => setEditingZone(null)} className="text-[10px] font-black text-white/30 uppercase">Cancel</button>
                              </div>
                            ) : (
                              <button onClick={() => setEditingZone(z)} className="text-[10px] font-black text-cyan-400 uppercase">Edit</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'lodging' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/40">
              Real merchant-declared lodging rates — the authoritative source for G-Escape lodging cost.
            </p>
            <button
              onClick={() => setEditingLodging({ nights: 3, max_guests: 4, is_active: true })}
              className="px-4 py-2 bg-cyan-500/15 border border-cyan-500/25 rounded-xl text-cyan-400 text-[10px] font-black uppercase tracking-widest hover:bg-cyan-500/25"
            >
              + New Lodging Node
            </button>
          </div>

          {editingLodging && (
            <div className="bg-white/5 rounded-2xl border border-cyan-500/20 p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <LField label="Name">
                  <input value={editingLodging.name ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, name: e.target.value })} className="admin-input" />
                </LField>
                <LField label="Merchant">
                  <select value={editingLodging.merchant_id ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, merchant_id: e.target.value })} className="admin-input">
                    <option value="">Select merchant…</option>
                    {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </LField>
                <LField label="Destination Code">
                  <input value={editingLodging.destination_code ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, destination_code: e.target.value.toUpperCase() })} placeholder="TOB" className="admin-input" />
                </LField>
                <LField label="Location Zone">
                  <select value={editingLodging.location_zone ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, location_zone: e.target.value })} className="admin-input">
                    <option value="">Select zone…</option>
                    {zones.map((z) => <option key={z.id} value={z.zone_name}>{z.zone_name}</option>)}
                  </select>
                </LField>
                <LField label="Nights">
                  <input type="number" value={editingLodging.nights ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, nights: Number(e.target.value) })} className="admin-input" />
                </LField>
                <LField label="Nightly Rate (TTD)">
                  <input type="number" step="0.01" value={editingLodging.base_price_per_night_cents ? (editingLodging.base_price_per_night_cents / 100).toFixed(2) : ''} onChange={(e) => setEditingLodging({ ...editingLodging, base_price_per_night_cents: Math.round(Number(e.target.value) * 100) })} className="admin-input" />
                </LField>
                <LField label="Max Guests">
                  <input type="number" value={editingLodging.max_guests ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, max_guests: Number(e.target.value) })} className="admin-input" />
                </LField>
              </div>

              <div className="border-t border-white/5 pt-4">
                <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-3">Owner Contact — G Co-Host</p>
                <div className="grid grid-cols-2 gap-4">
                  <LField label="Owner Name">
                    <input value={editingLodging.owner_name ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, owner_name: e.target.value })} className="admin-input" />
                  </LField>
                  <LField label="Owner Email">
                    <input type="email" value={editingLodging.owner_email ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, owner_email: e.target.value })} className="admin-input" />
                  </LField>
                  <LField label="Owner Phone">
                    <input value={editingLodging.owner_phone ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, owner_phone: e.target.value })} placeholder="+1868..." className="admin-input" />
                  </LField>
                  <LField label="Owner WhatsApp">
                    <input value={editingLodging.owner_whatsapp ?? ''} onChange={(e) => setEditingLodging({ ...editingLodging, owner_whatsapp: e.target.value })} placeholder="+1868..." className="admin-input" />
                  </LField>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">Description</p>
                  <button
                    onClick={draftCopy}
                    disabled={draftingCopy}
                    className="text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-cyan-300 disabled:opacity-40"
                  >
                    {draftingCopy ? 'Drafting…' : 'AI Draft'}
                  </button>
                </div>
                <textarea
                  value={editingLodging.description ?? ''}
                  onChange={(e) => setEditingLodging({ ...editingLodging, description: e.target.value })}
                  rows={3}
                  placeholder="What the rider sees on the listing — write it or click AI Draft, then edit before saving."
                  className="admin-input w-full"
                />
                <div className="flex items-center gap-3">
                  {editingLodging.cover_image_url && (
                    <img src={editingLodging.cover_image_url} alt="" className="w-16 h-16 rounded-xl object-cover border border-white/10" />
                  )}
                  <label className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/60 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 cursor-pointer">
                    {uploadingPhoto ? 'Uploading…' : editingLodging.cover_image_url ? 'Replace Photo' : 'Upload Photo'}
                    <input
                      type="file" accept="image/*" className="hidden" disabled={uploadingPhoto}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }}
                    />
                  </label>
                </div>
              </div>

              {candidateMsg && <p className="text-sm font-mono text-white/60">{candidateMsg}</p>}
              <div className="flex gap-3">
                <button onClick={() => saveLodging(editingLodging)} className="px-6 py-3 bg-green-500/15 border border-green-500/25 rounded-xl text-green-400 text-[10px] font-black uppercase tracking-widest">
                  Save {editingLodging.id ? '' : '(goes live immediately)'}
                </button>
                {!editingLodging.id && (
                  <button
                    onClick={() => submitCandidate(editingLodging)}
                    disabled={candidateSubmitting}
                    className="px-6 py-3 bg-cyan-500/15 border border-cyan-500/25 rounded-xl text-cyan-400 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    {candidateSubmitting ? 'Submitting…' : 'Submit as Candidate (needs approval)'}
                  </button>
                )}
                <button onClick={() => { setEditingLodging(null); setCandidateMsg(''); }} className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-white/40 text-[10px] font-black uppercase tracking-widest">Cancel</button>
              </div>
            </div>
          )}

          {lodgingLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid gap-3">
              {lodgingNodes.map((n) => (
                <div key={n.id} className="bg-white/5 rounded-2xl border border-white/10 p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {n.cover_image_url && <img src={n.cover_image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/10" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black text-white">{n.name}</p>
                        {n.requires_verification && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 uppercase tracking-widest">Unverified</span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 mt-1">
                        {n.destination_code} · {n.location_zone} · {n.nights} nights · up to {n.max_guests} guests
                        {n.owner_name ? ` · owner: ${n.owner_name}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-black text-cyan-400">{fmtTTD(n.base_price_per_night_cents)}/night</span>
                    <button onClick={() => setEditingLodging(n)} className="text-[10px] font-black text-cyan-400 uppercase">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'author' && (
        <div className="space-y-4">
          <p className="text-sm text-white/40">
            Creates a real flight block + escape package. Driver, lodging, and flight costs are sourced
            automatically from the real rate tables above — this form only supplies the identifiers.
          </p>
          <div className="bg-white/5 rounded-2xl border border-white/10 p-6 grid grid-cols-2 gap-4">
            <LField label="Package Name">
              <input value={authorForm.package_name} onChange={(e) => setAuthorForm({ ...authorForm, package_name: e.target.value })} className="admin-input" />
            </LField>
            <LField label="Destination Name">
              <input value={authorForm.destination_name} onChange={(e) => setAuthorForm({ ...authorForm, destination_name: e.target.value })} placeholder="Tobago" className="admin-input" />
            </LField>
            <LField label="Origin Code">
              <input value={authorForm.origin_code} onChange={(e) => setAuthorForm({ ...authorForm, origin_code: e.target.value.toUpperCase() })} className="admin-input" />
            </LField>
            <LField label="Destination Code">
              <input value={authorForm.destination_code} onChange={(e) => setAuthorForm({ ...authorForm, destination_code: e.target.value.toUpperCase() })} placeholder="TAB" className="admin-input" />
            </LField>
            <LField label="Departure">
              <input type="datetime-local" value={authorForm.departure_time} onChange={(e) => setAuthorForm({ ...authorForm, departure_time: e.target.value })} className="admin-input" />
            </LField>
            <LField label="Return (optional)">
              <input type="datetime-local" value={authorForm.return_time} onChange={(e) => setAuthorForm({ ...authorForm, return_time: e.target.value })} className="admin-input" />
            </LField>
            <LField label="Lodging Node">
              <select value={authorForm.lodging_node_id} onChange={(e) => setAuthorForm({ ...authorForm, lodging_node_id: e.target.value })} className="admin-input">
                <option value="">Select…</option>
                {lodgingNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </LField>
            <LField label="Price / Person">
              <p className="text-xs text-white/50 py-2">
                Computed automatically at creation from real flight + lodging + driver costs,
                run through the platform's pricing rules. Not editable here.
              </p>
            </LField>
            <LField label="Driver Origin Zone">
              <select value={authorForm.driver_origin_zone} onChange={(e) => setAuthorForm({ ...authorForm, driver_origin_zone: e.target.value })} className="admin-input">
                <option value="">Select…</option>
                {zones.map((z) => <option key={z.id} value={z.zone_name}>{z.zone_name}</option>)}
              </select>
            </LField>
            <LField label="Driver Destination Zone">
              <select value={authorForm.driver_destination_zone} onChange={(e) => setAuthorForm({ ...authorForm, driver_destination_zone: e.target.value })} className="admin-input">
                <option value="">Select…</option>
                {zones.map((z) => <option key={z.id} value={z.zone_name}>{z.zone_name}</option>)}
              </select>
            </LField>
            <LField label="Total Capacity Seats">
              <input type="number" value={authorForm.total_capacity_seats} onChange={(e) => setAuthorForm({ ...authorForm, total_capacity_seats: e.target.value })} className="admin-input" />
            </LField>
            <LField label="Tipping Point Seats">
              <input type="number" value={authorForm.tipping_point_seats} onChange={(e) => setAuthorForm({ ...authorForm, tipping_point_seats: e.target.value })} className="admin-input" />
            </LField>
          </div>
          {authorMsg && <p className="text-sm font-mono text-white/60">{authorMsg}</p>}
          <button
            onClick={submitAuthorPackage}
            disabled={authorSubmitting}
            className="px-8 py-4 bg-cyan-500/20 border border-cyan-500/40 rounded-xl text-cyan-400 text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 flex items-center gap-2"
          >
            <Send size={14} /> {authorSubmitting ? 'Creating…' : 'Create Package'}
          </button>
        </div>
      )}

      {tab === 'transfers' && (
        <div className="space-y-4">
          <p className="text-sm text-white/40">
            Real driver-assigned ground-transfer rides for confirmed G-Escape bookings — home/airport/villa,
            both directions. Created by <code className="text-cyan-400/70">execute_escape_group_confirmation</code>,
            paid from escrow on completion via the normal driver-app flow.
          </p>
          {transfersLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : transferRides.length === 0 ? (
            <div className="bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
              <Car size={40} className="text-white/10 mx-auto mb-4" />
              <p className="text-lg font-black text-white/40">No ground transfers yet</p>
              <p className="text-sm text-white/20 mt-1">These appear once a G-Escape flight block is confirmed.</p>
            </div>
          ) : (
            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white/[0.02]">
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Leg</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Booking Ref</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Route</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Scheduled</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest">Status</th>
                      <th className="px-6 py-4 text-[10px] font-black text-white/20 uppercase tracking-widest text-right">Fare</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {transferRides.map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02]">
                        <td className="px-6 py-4 text-xs font-bold text-white/70">
                          {r.reservation ? LEG_LABELS[r.reservation.leg] ?? r.reservation.leg : '—'}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-cyan-400/70">{r.reservation?.booking_ref ?? '—'}</td>
                        <td className="px-6 py-4 text-xs text-white/50">
                          {r.pickup_address ?? '—'} → {r.dropoff_address ?? '—'}
                        </td>
                        <td className="px-6 py-4 text-xs text-white/50">{r.scheduled_for ? fmtDatetime(r.scheduled_for) : '—'}</td>
                        <td className="px-6 py-4">
                          <span className={`text-[9px] font-black px-2.5 py-1 rounded-md border uppercase tracking-tight ${
                            r.status === 'completed' ? 'text-green-400 bg-green-400/10 border-green-500/20'
                            : r.status === 'in_progress' ? 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20'
                            : r.status === 'scheduled' ? 'text-white/40 bg-white/5 border-white/10'
                            : 'text-yellow-400 bg-yellow-400/10 border-yellow-500/20'
                          }`}>
                            {r.status}{!r.driver_id && r.status !== 'completed' ? ' · unassigned' : ''}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-black text-white text-right">{fmtTTD(r.total_fare_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'packages' && (
      <>

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
                    {pkg.flight_blocks && pkg.flight_blocks.status === 'POOLING' && (
                      <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-white/5">
                        <span className="text-xs text-white/50">
                          <span className="text-white font-bold">{pkg.live_headcount ?? 0}</span> real riders booked
                        </span>
                        {pkg.flight_blocks.locked_group_size != null ? (
                          <span className="text-xs font-bold text-purple-400">
                            Locked: {pkg.flight_blocks.locked_group_size} riders @ {pkg.flight_blocks.locked_discount_percent}% off
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-cyan-400/80">
                            Projected: {projectedGroupDiscount(pkg.live_headcount ?? 0)}% off (unlocked)
                          </span>
                        )}
                        {pkg.flight_blocks.fill_deadline_date && pkg.flight_blocks.locked_group_size == null && (
                          <span className="flex items-center gap-1 text-xs text-white/40">
                            <Clock size={12} />
                            {(() => {
                              const d = daysUntil(pkg.flight_blocks.fill_deadline_date);
                              return d === null ? '—' : d >= 0 ? `${d}d to fill deadline` : `${Math.abs(d)}d past fill deadline`;
                            })()}
                          </span>
                        )}
                        <span className="text-xs text-white/30">
                          {pkg.flight_blocks.confirming_provider ? (
                            (() => {
                              const key = pkg.flight_blocks.confirming_provider!.trim().toLowerCase();
                              const known = carrierPolicies.find((c) => c.carrier_name === key);
                              return known
                                ? `${pkg.flight_blocks.confirming_provider} (${known.name_submission_deadline_days}d policy)`
                                : `${pkg.flight_blocks.confirming_provider} (no profiled policy — using default)`;
                            })()
                          ) : (
                            'No carrier booked yet — deadline using default policy'
                          )}
                        </span>
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
      </>
      )}
    </div>
  );
}
