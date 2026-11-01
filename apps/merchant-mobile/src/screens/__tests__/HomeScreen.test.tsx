import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';
import { businessTypeFor } from '../../business/businessTypes';

const mockSetOpen = jest.fn(() => Promise.resolve(true));
const mockState: any = {};
const mockQuery = (result: unknown) => {
  const q: any = { select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok) };
  return q;
};
const mockTables: Record<string, unknown> = {};

jest.mock('../../context/MerchantContext', () => ({ useMerchant: () => mockState }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ selectionAsync: () => Promise.resolve() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#2DD4BF', accentDark: '#0F766E', copperBright: '#D9A06B', text: '#fff', textMuted: '#999', surface: '#222', serifSemi: 'serif' } } }));
jest.mock('@gtaxi/design-system-native/src/crystal', () => ({ CrystalFace: () => null, RaisedIcon: () => null }));
jest.mock('@gtaxi/core', () => ({ initializeSupabaseClient: () => ({ supabase: { from: (t: string) => mockQuery(mockTables[t] ?? { data: [], count: 0 }) } }) }));

const merchant = { id: 'm-1', name: 'Roti Hut', category: 'creole', business_type: null, address: 'Chaguanas', cover_image_url: null, is_open: false, is_active: true, activation_status: 'active', created_by: 'u-1' };
const navigation = { navigate: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockTables).forEach((k) => delete mockTables[k]);
  Object.assign(mockState, { merchant, type: businessTypeFor(merchant), isOwner: true, loading: false, failed: false, reload: jest.fn(), setOpen: mockSetOpen, setBusinessType: jest.fn() });
});

// The first render compiles the whole screen; a busy machine can take over 5 seconds.
jest.setTimeout(30000);

describe('Merchant HomeScreen', () => {
  it('leads with the storefront and the work for this type of business', async () => {
    mockTables.merchant_orders = { data: [{ status: 'pending', total_cents: 5000, created_at: new Date().toISOString() }, { status: 'confirmed', total_cents: 1000, created_at: new Date().toISOString() }] };
    const { getByText, findByText } = render(<HomeScreen navigation={navigation} />);
    expect(getByText('Roti Hut')).toBeTruthy();
    expect(getByText('Food · Chaguanas')).toBeTruthy();
    fireEvent.press(await findByText('2 orders'));
    expect(navigation.navigate).toHaveBeenCalledWith('Work');
  });

  it('shows the shelf customers will see', async () => {
    mockTables.products = { data: [{ id: 'p1', name: 'Doubles', price_cents: 800, image_url: null, is_available: true }], count: 1 };
    const { findByText, getByText } = render(<HomeScreen navigation={navigation} />);
    expect(await findByText('Doubles')).toBeTruthy();
    expect(getByText('Your menu')).toBeTruthy();
    expect(getByText('$8.00')).toBeTruthy();
  });

  it('opens the storefront', () => {
    const { getByLabelText } = render(<HomeScreen navigation={navigation} />);
    fireEvent(getByLabelText('Open or close your storefront'), 'valueChange', true);
    expect(mockSetOpen).toHaveBeenCalledWith(true);
  });

  it('tells a new business it is being reviewed', () => {
    mockState.merchant = { ...merchant, activation_status: 'pending' };
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    expect(getByText(/G 868 is reviewing your business/)).toBeTruthy();
  });

  it('points an empty menu to adding the first dish', async () => {
    mockTables.products = { count: 0 };
    const { findByText } = render(<HomeScreen navigation={navigation} />);
    expect(await findByText('Add a dish')).toBeTruthy();
  });

  it('asks an owner with no known type', () => {
    mockState.type = null;
    mockState.merchant = { ...merchant, category: 'local' };
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    expect(getByText('What kind of business are you?')).toBeTruthy();
  });

  it('never dead-ends when the business fails to load', async () => {
    mockState.merchant = null;
    mockState.failed = true;
    const { getByText } = render(<HomeScreen navigation={navigation} />);
    fireEvent.press(getByText('Try again'));
    await waitFor(() => expect(mockState.reload).toHaveBeenCalled());
  });
});
