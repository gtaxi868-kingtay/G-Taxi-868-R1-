import { useState, useEffect } from 'react';
import { supabase, adminFetch } from '../lib/supabase';
import { 
  Users, CheckCircle2, XCircle, FileText, Shield, 
  Car, CreditCard, Clock, AlertCircle, ExternalLink 
} from 'lucide-react';

interface PendingDriver {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
  avatar_url: string | null;
  driver_record: {
    vehicle_plate: string;
    vehicle_make: string;
    vehicle_model: string;
  } | null;
  documents: Array<{
    document_type: string;
    storage_path: string;
    uploaded_at: string;
    status: string;
  }>;
  has_license: boolean;
  has_insurance: boolean;
  has_vehicle_photo: boolean;
}

export const DriverApproval = ({ onRefresh }: { onRefresh: () => void }) => {
  const [pendingDrivers, setPendingDrivers] = useState<PendingDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<PendingDriver | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    with_license: 0,
    with_insurance: 0,
    with_vehicle_photo: 0,
  });

  useEffect(() => {
    fetchPendingDrivers();
  }, []);

  const fetchPendingDrivers = async () => {
    try {
      setLoading(true);
      const data = await adminFetch('admin_get_pending_drivers', {});
      setPendingDrivers(data.pending || []);
      setStats({
        total: data.count || 0,
        with_license: data.summary?.with_license || 0,
        with_insurance: data.summary?.with_insurance || 0,
        with_vehicle_photo: data.summary?.with_vehicle_photo || 0,
      });
    } catch (err: any) {
      console.error('Failed to fetch pending drivers:', err);
      alert('Failed to load pending drivers: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (driver: PendingDriver) => {
    if (!window.confirm(`Approve ${driver.name} as a verified driver?`)) return;
    
    setProcessing(driver.id);
    try {
      await adminFetch('admin_toggle_driver', { 
        user_id: driver.id, 
        action: 'authorize',
        name: driver.name 
      });
      
      // Send push notification to driver
      try {
        await adminFetch('send_push_notification', {
          user_id: driver.id,
          title: 'G-Taxi - Approved! 🎉',
          body: `Congratulations ${driver.name.split(' ')[0]}! You're now a verified G-Taxi driver. Open the app to start accepting rides.`,
          data: { type: 'driver_approved' }
        });
      } catch (pushErr) {
        console.warn('Push notification failed:', pushErr);
      }
      
      setPendingDrivers(prev => prev.filter(d => d.id !== driver.id));
      setStats(prev => ({ ...prev, total: prev.total - 1 }));
      onRefresh();
    } catch (err: any) {
      alert('Approval failed: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (driver: PendingDriver) => {
    const reason = window.prompt(`Reject ${driver.name}. Reason (optional):`);
    if (reason === null) return; // Cancelled
    
    setProcessing(driver.id);
    try {
      // For now, we just send a notification. Could also update status to 'rejected' if that field exists
      await adminFetch('send_push_notification', {
        user_id: driver.id,
        title: 'G-Taxi - Application Update',
        body: reason 
          ? `Your driver application needs attention: ${reason}. Please update your documents and reapply.`
          : `Your driver application could not be approved at this time. Please contact support for more information.`,
        data: { type: 'driver_rejected' }
      });
      
      setPendingDrivers(prev => prev.filter(d => d.id !== driver.id));
      setStats(prev => ({ ...prev, total: prev.total - 1 }));
    } catch (err: any) {
      alert('Rejection failed: ' + err.message);
    } finally {
      setProcessing(null);
    }
  };

  const getDocumentUrl = (path: string) => {
    return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/driver-documents/${path}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          label="Pending Approval" 
          value={stats.total} 
          icon={<Users className="w-5 h-5" />}
          color="purple"
        />
        <StatCard 
          label="With License" 
          value={stats.with_license} 
          icon={<CreditCard className="w-5 h-5" />}
          color="cyan"
        />
        <StatCard 
          label="With Insurance" 
          value={stats.with_insurance} 
          icon={<Shield className="w-5 h-5" />}
          color="green"
        />
        <StatCard 
          label="Vehicle Photos" 
          value={stats.with_vehicle_photo} 
          icon={<Car className="w-5 h-5" />}
          color="orange"
        />
      </div>

      {/* PENDING DRIVERS LIST */}
      {pendingDrivers.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">All Caught Up!</h3>
          <p className="text-white/50">No pending driver applications to review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingDrivers.map((driver) => (
            <div 
              key={driver.id}
              className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-white/20 transition-all"
            >
              <div className="flex items-start gap-4">
                {/* AVATAR */}
                <div className="w-14 h-14 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  {driver.avatar_url ? (
                    <img src={driver.avatar_url} alt="" className="w-full h-full rounded-xl object-cover" />
                  ) : (
                    <Users className="w-6 h-6 text-white/40" />
                  )}
                </div>

                {/* INFO */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-white">{driver.name}</h3>
                    <span className="text-xs text-white/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Applied {formatDate(driver.created_at)}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-4 text-sm text-white/50 mb-3">
                    <span>{driver.email}</span>
                    <span>{driver.phone}</span>
                  </div>

                  {/* DOCUMENTS STATUS */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <DocBadge has={driver.has_license} label="Driver's License" />
                    <DocBadge has={driver.has_insurance} label="Insurance" />
                    <DocBadge has={driver.has_vehicle_photo} label="Vehicle Photo" />
                  </div>

                  {/* VEHICLE INFO */}
                  {driver.driver_record && (
                    <div className="text-sm text-white/40 mb-4">
                      <span className="text-white/60">Vehicle:</span> {driver.driver_record.vehicle_make} {driver.driver_record.vehicle_model} • {driver.driver_record.vehicle_plate}
                    </div>
                  )}

                  {/* ACTION BUTTONS */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleApprove(driver)}
                      disabled={processing === driver.id}
                      className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 rounded-lg border border-green-500/30 hover:bg-green-500/30 transition-all disabled:opacity-50"
                    >
                      {processing === driver.id ? (
                        <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Approve Driver
                    </button>
                    
                    <button
                      onClick={() => handleReject(driver)}
                      disabled={processing === driver.id}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg border border-red-500/30 hover:bg-red-500/30 transition-all disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>

                    {driver.documents.length > 0 && (
                      <button
                        onClick={() => setSelectedDriver(driver)}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white/70 rounded-lg border border-white/20 hover:bg-white/15 transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Documents ({driver.documents.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DOCUMENT VIEWER MODAL */}
      {selectedDriver && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D0B1E] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                Documents: {selectedDriver.name}
              </h3>
              <button 
                onClick={() => setSelectedDriver(null)}
                className="p-2 hover:bg-white/10 rounded-lg transition-all"
              >
                <XCircle className="w-5 h-5 text-white/60" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {selectedDriver.documents.map((doc, idx) => (
                <div key={idx} className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-cyan-400" />
                      <span className="font-medium text-white capitalize">
                        {doc.document_type.replace('_', ' ')}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      doc.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                      doc.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {doc.status}
                    </span>
                  </div>
                  
                  {doc.storage_path.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                    <img 
                      src={getDocumentUrl(doc.storage_path)} 
                      alt={doc.document_type}
                      className="w-full h-48 object-contain bg-black/50 rounded-lg"
                    />
                  ) : (
                    <a 
                      href={getDocumentUrl(doc.storage_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-cyan-400 hover:underline"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View Document
                    </a>
                  )}
                  
                  <p className="text-xs text-white/40 mt-2">
                    Uploaded {formatDate(doc.uploaded_at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) => {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-black">{value}</div>
    </div>
  );
};

const DocBadge = ({ has, label }: { has: boolean; label: string }) => (
  <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
    has 
      ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
      : 'bg-red-500/10 text-red-400 border border-red-500/20'
  }`}>
    {has ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
    {label}
  </span>
);
