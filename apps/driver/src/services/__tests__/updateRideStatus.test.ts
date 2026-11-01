import { updateRideStatus } from '../api';

const mockInvoke = jest.fn();
const mockEnqueue = jest.fn();
jest.mock('@gtaxi/core', () => ({ supabase: { functions: { invoke: (...a: any[]) => mockInvoke(...a) } } }));
jest.mock('@g868/shared/OutboxService', () => ({ OutboxService: { getInstance: () => ({ enqueue: mockEnqueue }) } }));
jest.mock('@g868/shared/env', () => ({ ENV: { SUPABASE_URL: 'https://test.supabase.co' } }));
jest.mock('@g868/shared', () => ({ RideEngine: { completeRide: (_id: string, fn: () => unknown) => fn(), acceptRide: (_id: string, fn: () => unknown) => fn() } }));

function refusal(message: string, body: object) {
  const e: any = new Error(message);
  e.name = 'FunctionsHttpError';
  e.context = { status: 403, json: async () => body };
  return e;
}

describe('updateRideStatus refusals', () => {
  beforeEach(() => { mockInvoke.mockReset(); mockEnqueue.mockReset(); });

  it("hands back the server's own reason, not the technical wrapper", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: refusal('Edge Function returned a non-2xx status code', { success: false, error: 'Too far from dropoff. You are 1240m away (max 150m).' }) });
    const { error } = await updateRideStatus('r1', 'completed', 10.6, -61.3);
    expect((error as Error).message).toBe('Too far from dropoff. You are 1240m away (max 150m).');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('still queues the action when the request never reached the server', async () => {
    const offline: any = new Error('Failed to send a request to the Edge Function');
    offline.name = 'FunctionsFetchError';
    mockInvoke.mockResolvedValue({ data: null, error: offline });
    await updateRideStatus('r1', 'completed', 10.6, -61.3);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('returns the mapped data on success', async () => {
    mockInvoke.mockResolvedValue({ data: { data: { ride_id: 'r1', status: 'completed', driver_payout_cents: 3200, total_fare_cents: 4000 } }, error: null });
    const { data, error } = await updateRideStatus('r1', 'completed', 10.6, -61.3);
    expect(error).toBeNull();
    expect(data?.driver_payout_cents).toBe(3200);
  });
});
