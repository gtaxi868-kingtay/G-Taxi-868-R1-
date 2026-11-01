import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrdersScreen } from '../OrdersScreen';

const mockInvoke = jest.fn(() => Promise.resolve({ data: { success: true }, error: null }));
const now = new Date().toISOString();
const mockOrders = [
  { id: 'o1', status: 'pending', created_at: now, total_cents: 4500, delivery_method: 'merchant_delivery', payment_status: 'cash_on_delivery' },
  { id: 'o2', status: 'preparing', created_at: now, total_cents: 1200, delivery_method: 'pickup', payment_status: 'captured' },
  { id: 'o3', status: 'delivered', created_at: now, total_cents: 900, delivery_method: 'pickup', payment_status: 'captured' },
];
const mockItems = [{ order_id: 'o1', quantity: 2, products: { name: 'Buss-up shot' } }];
const mockQuery = (rows: unknown[]) => {
  const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok) };
  return q;
};

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-haptics', () => ({ selectionAsync: () => Promise.resolve() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#2DD4BF', text: '#fff', textMuted: '#999', surface: '#222', serifSemi: 'serif' } } }));
jest.mock('@gtaxi/design-system-native/src/crystal', () => ({ CrystalFace: () => null }));
jest.mock('../../context/MerchantContext', () => ({ useMerchant: () => ({ merchant: { id: 'm-1' } }) }));
jest.mock('@gtaxi/core', () => ({ initializeSupabaseClient: () => ({ supabase: {
  from: (t: string) => mockQuery(t === 'merchant_orders' ? mockOrders : t === 'order_items' ? mockItems : []),
  functions: { invoke: (...a: unknown[]) => (mockInvoke as any)(...a) },
  channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; },
  removeChannel: jest.fn(),
} }) }));

// The first render compiles the whole screen; a busy machine can take over 5 seconds.
jest.setTimeout(30000);

describe('Merchant OrdersScreen', () => {
  it('sorts orders onto the board and shows what was ordered', async () => {
    const { findByText, getByText } = render(<OrdersScreen navigation={{ goBack: jest.fn() }} />);
    expect(await findByText('2 × Buss-up shot')).toBeTruthy();
    expect(getByText('New · 1')).toBeTruthy();
    expect(getByText('Being prepared · 1')).toBeTruthy();
    expect(getByText('Finished · 1')).toBeTruthy();
    expect(getByText('Delivery · Cash on delivery')).toBeTruthy();
  });

  it('moves an order forward', async () => {
    const { findByText } = render(<OrdersScreen navigation={{ goBack: jest.fn() }} />);
    fireEvent.press(await findByText('Accept order'));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('merchant', { body: { action: 'update_order_status', order_id: 'o1', new_status: 'confirmed' } }));
  });
});
