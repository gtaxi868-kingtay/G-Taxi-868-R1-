import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { BrandScreen } from '../BrandScreen';

const mockRpc = jest.fn(() => Promise.resolve({ error: null }));
const mockRows = [
  { id: 'c1', headline: 'Your full shop', offer_text: 'Ride home', accent_color: '#22D3EE', audience: 'everyone', ends_on: null, status: 'awaiting_business', paused_by_side: null, change_note: null },
  { id: 'c2', headline: 'On the pin', offer_text: null, accent_color: '#8B5CF6', audience: 'my_clients', ends_on: null, status: 'live', paused_by_side: null, change_note: null },
];

const mockAuth = { user: { id: 'u-1' } };
jest.mock('../../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@gtaxi/design-system', () => ({ SURFACE: { base: '#141122' }, VOICES: { merchant: { accent: '#2DD4BF', textMuted: '#999' } } }));
jest.mock('@gtaxi/design-system/utils/style-rules', () => ({ glassSurface: () => ({}) }));
jest.mock('@gtaxi/core', () => ({
  initializeSupabaseClient: () => ({
    supabase: {
      rpc: (...a: unknown[]) => (mockRpc as any)(...a),
      from: (table: string) => table === 'merchants'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'm-1' } }) }) }) }
        : { select: () => ({ eq: () => ({ neq: () => ({ order: () => Promise.resolve({ data: mockRows }) }) }) }) },
    },
  }),
}));

// The first render compiles the whole screen; a busy CI runner can take over 5 seconds.
jest.setTimeout(30000);

const navigation = { goBack: jest.fn() } as any;

describe('BrandScreen', () => {
  beforeEach(() => mockRpc.mockClear());

  it('shows what is waiting and what is live', async () => {
    const { findByText, getByText } = render(<BrandScreen navigation={navigation} />);
    expect(await findByText('Your full shop')).toBeTruthy();
    expect(getByText('On the pin')).toBeTruthy();
    expect(getByText('Shown to your clients')).toBeTruthy();
  });

  it('approves the waiting version', async () => {
    const { findByText } = render(<BrandScreen navigation={navigation} />);
    fireEvent.press(await findByText('Approve'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('partner_campaign_decide', { p_id: 'c1', p_decision: 'approve', p_note: null }));
  });

  it('needs a note before asking for a change', async () => {
    const { findByText, getByLabelText, getAllByText } = render(<BrandScreen navigation={navigation} />);
    fireEvent.press(await findByText('Ask for a change'));
    fireEvent.press(getAllByText('Send to G 868')[0]);
    expect(mockRpc).not.toHaveBeenCalled();
    fireEvent.changeText(getByLabelText('What should we change?'), 'Use our green');
    fireEvent.press(getAllByText('Send to G 868')[0]);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('partner_campaign_decide', { p_id: 'c1', p_decision: 'request_changes', p_note: 'Use our green' }));
  });

  it('sends a new package for G 868 to review', async () => {
    const { findAllByText, getByLabelText, getAllByText } = render(<BrandScreen navigation={navigation} />);
    await findAllByText('Send to G 868');
    fireEvent.changeText(getByLabelText('Headline'), 'Two for one');
    const buttons = getAllByText('Send to G 868');
    fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('partner_campaign_save', expect.objectContaining({ p_merchant_id: 'm-1', p_headline: 'Two for one', p_audience: 'everyone' })));
  });
});
