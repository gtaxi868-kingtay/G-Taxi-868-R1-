import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { LoginScreen } from '../LoginScreen';

// Mock the AuthContext
const mockSignIn = jest.fn();
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        signIn: mockSignIn,
    }),
}));

jest.mock('@gtaxi/design-system/native', () => ({
    RainLogin: ({ children, footer }: any) => {
        const React = require('react');
        const { View } = require('react-native');
        return React.createElement(View, null, children, footer);
    },
    CrystalInput: ({ label, placeholder, value, onChangeText, secureTextEntry, keyboardType }: any) => {
        const React = require('react');
        const { TextInput, View, Text } = require('react-native');
        return React.createElement(View, null,
            React.createElement(Text, null, label),
            React.createElement(TextInput, { placeholder, value, onChangeText, secureTextEntry, keyboardType })
        );
    },
    CrystalButton: ({ title, onPress, loading }: any) => {
        const React = require('react');
        const { TouchableOpacity, Text } = require('react-native');
        return React.createElement(TouchableOpacity, { onPress }, React.createElement(Text, null, loading ? 'Loading...' : title));
    },
}));

jest.mock('@gtaxi/design-system', () => ({
    VOICES: { rider: { accent: '#d2bbff' } },
}));

// Mock Navigation
const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
};

describe('LoginScreen', () => {
    beforeEach(() => {
        mockSignIn.mockClear();
        mockNavigation.navigate.mockClear();
    });

    it('renders correctly', () => {
        const { getByPlaceholderText, getByText } = render(
            <LoginScreen navigation={mockNavigation} />
        );

        expect(getByPlaceholderText('you@email.com')).toBeTruthy();
        expect(getByPlaceholderText('••••••••')).toBeTruthy();
        expect(getByText('Sign In')).toBeTruthy();
    });

    it('shows error when fields are empty', () => {
        const { getByText } = render(<LoginScreen navigation={mockNavigation} />);

        fireEvent.press(getByText('Sign In'));

        expect(getByText('Enter your email and password')).toBeTruthy();
        expect(mockSignIn).not.toHaveBeenCalled();
    });

    it('calls signIn with correct credentials', async () => {
        const { getByPlaceholderText, getByText } = render(
            <LoginScreen navigation={mockNavigation} />
        );

        fireEvent.changeText(getByPlaceholderText('you@email.com'), 'test@example.com');
        fireEvent.changeText(getByPlaceholderText('••••••••'), 'password123');

        fireEvent.press(getByText('Sign In'));

        await waitFor(() => {
            expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123');
        });
    });
});
