export default async function handler(req, res) {
  // Proxy to Supabase Edge Function `site`
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Missing supabase config' });
    const qs = req.url.split('?')[1] || '';
    const apiRes = await fetch(`${SUPABASE_URL}/functions/v1/site${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const data = await apiRes.text();
    res.status(apiRes.status).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
