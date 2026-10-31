import { tripStep, tripRefusal } from '../tripStep';

describe('tripStep', () => {
  it('walks a ride through pickup, wait and drop-off with one button each', () => {
    expect(tripStep('assigned', false, false)).toMatchObject({ step: 0, title: 'Head to pickup', action: 'arrived' });
    expect(tripStep('arrived', false, false)).toMatchObject({ step: 1, action: 'verify', actionLabel: 'Enter rider PIN' });
    expect(tripStep('in_progress', false, false)).toMatchObject({ step: 2, action: 'complete', actionLabel: 'Complete trip' });
  });
  it('holds a delivery pickup until the shop photo is in', () => {
    expect(tripStep('arrived', true, false)).toMatchObject({ action: 'deliveryPickup', actionEnabled: false });
    expect(tripStep('arrived', true, true)).toMatchObject({ action: 'deliveryPickup', actionEnabled: true });
    expect(tripStep('in_progress', true, true).actionLabel).toBe('Mark delivered');
  });
  it('shows no action once finished', () => {
    expect(tripStep('completed', false, false).action).toBeNull();
  });
});

describe('tripRefusal', () => {
  it('says how far the driver is from the drop-off', () => {
    expect(tripRefusal('Too far from dropoff. You are 1240m away (max 150m).')).toEqual({ title: 'Not at the drop-off yet', body: 'You are 1.2 km away. Finish the trip once you are within 150 m of the drop-off.' });
    expect(tripRefusal('Too far from dropoff. You are 300m away (max 150m).').body).toMatch(/300 m away/);
  });
  it('never shows the technical message', () => {
    expect(tripRefusal('Edge Function returned a non-2xx status code').body).toBe('Check your signal and try again.');
    expect(tripRefusal(null).body).toBe('Check your signal and try again.');
  });
  it('passes a readable server reason through', () => {
    expect(tripRefusal('Ride cannot be completed from status assigned').body).toMatch(/cannot be completed/);
  });
});
