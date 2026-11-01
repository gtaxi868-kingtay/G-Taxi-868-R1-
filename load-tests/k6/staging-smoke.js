import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const nearbyLatency = new Trend('nearby_drivers_latency', true);
const baseUrl = __ENV.SUPABASE_URL;
const anonKey = __ENV.SUPABASE_ANON_KEY;
const accessToken = __ENV.STAGING_ACCESS_TOKEN;

if (!baseUrl || !anonKey || !accessToken) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and STAGING_ACCESS_TOKEN are required');
}

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '3m', target: 500 },
    { duration: '3m', target: 1000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    nearby_drivers_latency: ['p(95)<1000'],
  },
};

export default function () {
  const response = http.post(
    `${baseUrl}/functions/v1/get_nearby_drivers`,
    JSON.stringify({ lat: 10.536, lng: -61.311, radius: 5 }),
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      tags: { scenario: 'nearby_drivers' },
    },
  );

  nearbyLatency.add(response.timings.duration);
  check(response, {
    'nearby drivers returns 2xx': (result) => result.status >= 200 && result.status < 300,
    'nearby drivers returns JSON': (result) => result.headers['Content-Type']?.includes('application/json'),
  });
  sleep(10);
}
