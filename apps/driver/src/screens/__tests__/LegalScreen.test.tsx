import React from 'react';
import { render } from '@testing-library/react-native';
import { LegalScreen } from '../LegalScreen';

describe('LegalScreen', () => {
  it('renders without crashing', () => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const { getByText } = render(<LegalScreen navigation={navigation as any} />);
    expect(getByText(/Operator Agreements/i)).toBeTruthy();
  });
});
