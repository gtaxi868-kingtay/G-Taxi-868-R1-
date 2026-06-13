import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseICalDates(icalText: string): Set<string> {
  const bookedDates = new Set<string>();
  const vevents = icalText.split('BEGIN:VEVENT');
  for (let i = 1; i < vevents.length; i++) {
    const vevent = vevents[i];
    const dtStartMatch = vevent.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
    const dtEndMatch = vevent.match(/DTEND(?:;[^:]*)?:(\d{8})/);
    if (!dtStartMatch || !dtEndMatch) continue;
    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch[1];
    const start = new Date(
      parseInt(startStr.slice(0, 4)),
      parseInt(startStr.slice(4, 6)) - 1,
      parseInt(startStr.slice(6, 8))
    );
    const end = new Date(
      parseInt(endStr.slice(0, 4)),
      parseInt(endStr.slice(4, 6)) - 1,
      parseInt(endStr.slice(6, 8))
    );
    const cur = new Date(start);
    while (cur < end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      bookedDates.add(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return bookedDates;
}

function dateRange(days: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const authHeader = req.headers.get('Authorization');
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const { property_id } = body;

  const WINDOW_DAYS = 120;
  const allDates = dateRange(WINDOW_DAYS);

  let properties: any[] = [];
  if (property_id) {
    const { data, error } = await supabase
      .from('travel_properties')
      .select('id, name, ical_urls')
      .eq('id', property_id)
      .eq('is_active', true);
    if (error || !data?.length) {
      return new Response(JSON.stringify({ error: 'Property not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    properties = data;
  } else {
    const { data, error } = await supabase
      .from('travel_properties')
      .select('id, name, ical_urls')
      .eq('is_active', true)
      .not('ical_urls', 'eq', '{}');
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    properties = data ?? [];
  }

  const results: any[] = [];
  for (const prop of properties) {
    const icalUrls: Record<string, string> = prop.ical_urls ?? {};
    if (!Object.keys(icalUrls).length) continue;

    await supabase.from('travel_properties').update({ sync_status: 'syncing' }).eq('id', prop.id);

    let totalUpserted = 0;
    let syncError: string | null = null;

    for (const [roomType, url] of Object.entries(icalUrls)) {
      try {
        const resp = await fetch(url as string);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const icalText = await resp.text();
        const bookedDates = parseICalDates(icalText);

        const rows = allDates.map(date => ({
          property_id: prop.id,
          room_type: roomType,
          date,
          is_available: !bookedDates.has(date),
          source: 'ical',
          synced_at: new Date().toISOString(),
        }));

        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error: upsertErr } = await supabase
            .from('property_availability')
            .upsert(batch, { onConflict: 'property_id,room_type,date' });
          if (upsertErr) throw upsertErr;
          totalUpserted += batch.length;
        }
      } catch (e: any) {
        syncError = e.message;
      }
    }

    await supabase.from('travel_properties').update({
      sync_status: syncError ? 'error' : 'synced',
      sync_error: syncError,
      last_sync_at: new Date().toISOString(),
    }).eq('id', prop.id);

    results.push({ property_id: prop.id, name: prop.name, upserted: totalUpserted, error: syncError });
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
