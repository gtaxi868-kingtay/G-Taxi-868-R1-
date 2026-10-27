import { tripStep } from '../tripStep';

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
