import React from 'react';
import { render } from '@testing-library/react-native';
import { StopWaitHUD } from '../StopWaitHUD';

jest.mock('../../hooks/useStopWaitTimer', () => ({ useStopWaitTimer: () => ({ seconds: 120, feeCents: 500 }) }));

describe('StopWaitHUD', () => {
  it('renders without crashing', () => {
    const { getByText } = render(<StopWaitHUD stopId="test" isActive={true} />);
    expect(getByText(/TRUTHFUL WAIT TIMER/i)).toBeTruthy();
  });
});
