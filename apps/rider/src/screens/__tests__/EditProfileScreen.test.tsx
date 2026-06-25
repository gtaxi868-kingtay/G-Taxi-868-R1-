import React from 'react';
import { render } from '@testing-library/react-native';
import { EditProfileScreen } from '../EditProfileScreen';

jest.mock('@gtaxi/core', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), from: () => ({ select: () => ({ eq: () => ({ single: jest.fn(), maybeSingle: jest.fn(), order: () => ({ limit: () => ({ data: null }) }) }) }) }) } }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test' }, profile: { full_name: 'Test', phone_number: '', avatar_url: '' }, refreshProfile: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' }, NotificationFeedbackType: { Success: 'Success', Warning: 'Warning' }, selectionAsync: jest.fn() }));

describe('EditProfileScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const route = { params: {}, key: 'test', name: 'EditProfile' as const };
    const { getByText } = render(<EditProfileScreen navigation={navigation as any} route={route as any} />);
    expect(getByText(/Edit Profile/i)).toBeTruthy();
  });
});
