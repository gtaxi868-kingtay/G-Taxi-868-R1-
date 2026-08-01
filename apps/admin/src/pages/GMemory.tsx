import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, FileText, Trash2, Loader2, Brain, RefreshCw } from 'lucide-react';

interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  file_name: string;
  storage_path: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const CATEGORIES = ['general', 'legal', 'compliance', 'vendor_quote', 'financial', 'research'] as const;

export function GMemory() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('general');
  const [notes, setNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // g_knowledge_documents has an admin-only RLS "FOR ALL" policy, so the
    // admin web client can read/write it directly — same pattern already
    // used for lodging-photos in EscapeManagement.tsx, no edge function
    // needed for a plain admin-only CRUD table.
    const { data, error } = await supabase
      .from('g_knowledge_documents')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setDocs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) { alert('Choose a file first'); return; }
    if (!title.trim()) { alert('Title is required'); return; }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('g-knowledge-docs').upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('g_knowledge_documents').insert({
        title: title.trim(),
        category,
        storage_path: path,
        file_name: file.name,
        notes: notes.trim() || null,
        uploaded_by: user.id,
      });
      if (insErr) throw insErr;

      setTitle('');
      setNotes('');
      setCategory('general');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const toggleActive = async (doc: KnowledgeDoc) => {
    const { error } = await supabase.from('g_knowledge_documents')
      .update({ is_active: !doc.is_active, updated_at: new Date().toISOString() })
      .eq('id', doc.id);
    if (!error) load();
  };

  const remove = async (doc: KnowledgeDoc) => {
    if (!window.confirm(`Delete "${doc.title}"? This removes it from G's context permanently.`)) return;
    await supabase.storage.from('g-knowledge-docs').remove([doc.storage_path]);
    const { error } = await supabase.from('g_knowledge_documents').delete().eq('id', doc.id);
    if (!error) load();
  };

  const openDoc = async (doc: KnowledgeDoc) => {
    const { data, error } = await supabase.storage.from('g-knowledge-docs').createSignedUrl(doc.storage_path, 300);
    if (error || !data?.signedUrl) { alert('Could not open document'); return; }
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white italic tracking-tight">G MEMORY</h2>
          <p className="text-xs font-medium text-white/20 uppercase tracking-[0.4em] mt-1">Documents G Reads Before Reasoning</p>
        </div>
        <button onClick={load} className="btn-press h-12 px-6 rounded-xl bg-white/5 border border-white/10 text-white/50 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-3">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center gap-2 text-white/50 text-xs font-black uppercase tracking-widest mb-2">
          <Brain size={14} /> Upload a reference document
        </div>
        <p className="text-xs text-white/40">
          Uploads the file to storage and writes a real row G's Fleet department reads via
          get_knowledge_documents. G reads the notes field, not the raw file (no OCR/embeddings
          exist in this system) — summarize the document's relevant conclusion in Notes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm"
              placeholder="e.g. ATL Automotive fleet-deal terms" />
          </div>
          <div>
            <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">Notes (what G should actually know from this document)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm"
            placeholder="e.g. ATL quoted TT$XXX,XXX/unit for 10+ vehicle fleet orders, 24-month warranty included" />
        </div>
        <div>
          <label className="text-[10px] font-black text-white/30 uppercase tracking-widest">File</label>
          <input ref={fileInputRef} type="file" className="w-full mt-1 text-white/60 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-cyan-500/10 file:text-cyan-400 file:text-xs file:font-black file:uppercase" />
        </div>
        <button onClick={upload} disabled={uploading}
          className="btn-press h-12 px-6 rounded-xl bg-cyan-500 text-black font-black text-xs uppercase tracking-widest hover:bg-cyan-400 transition-all disabled:opacity-40 flex items-center gap-2">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Loader2 className="animate-spin mx-auto text-white/30" size={32} /></div>
      ) : docs.length === 0 ? (
        <div className="py-16 text-center bg-white/[0.02] rounded-[2rem] border border-dashed border-white/5">
          <FileText size={40} className="mx-auto mb-4 text-white/20" />
          <p className="text-white/60 font-black text-xs">No documents yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <div key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={14} className="text-cyan-400/60 shrink-0" />
                  <button onClick={() => openDoc(d)} className="text-white font-bold text-sm hover:text-cyan-400 transition-colors truncate">{d.title}</button>
                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-white/40 text-[9px] font-black uppercase shrink-0">{d.category}</span>
                  {!d.is_active && <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[9px] font-black uppercase shrink-0">inactive</span>}
                </div>
                {d.notes && <p className="text-xs text-white/40 line-clamp-2">{d.notes}</p>}
                <p className="text-[10px] font-mono text-white/20 mt-1">{d.file_name} · {new Date(d.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toggleActive(d)} className="btn-press text-[9px] font-black px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:bg-white/10 transition-colors">
                  {d.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => remove(d)} className="btn-press p-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
