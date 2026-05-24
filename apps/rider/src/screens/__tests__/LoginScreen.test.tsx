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

        expect(getByPlaceholderText('Enter your email')).toBeTruthy();
        expect(getByPlaceholderText('Enter your password')).toBeTruthy();
        expect(getByText('Sign In')).toBeTruthy();
    });

    it('shows error when fields are empty', () => {
        const { getByText } = render(<LoginScreen navigation={mockNavigation} />);

        fireEvent.press(getByText('Sign In'));

        expect(getByText('⚠️ Please fill in all fields')).toBeTruthy();
        expect(mockSignIn).not.toHaveBeenCalled();
    });

    it('calls signIn with correct credentials', async () => {
        const { getByPlaceholderText, getByText } = render(
            <LoginScreen navigation={mockNavigation} />
        );

        fireEvent.changeText(getByPlaceholderText('Enter your email'), 'test@example.com');
        fireEvent.changeText(getByPlaceholderText('Enter your password'), 'password123');

        fireEvent.press(getByText('Sign In'));

        await waitFor(() => {
            expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123');
        });
    });
});
