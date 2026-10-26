import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FaceAutoCapture } from '../FaceAutoCapture';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView' }));
jest.mock('expo-file-system', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));

// Jest has no native ML Kit module, which is exactly the "older install / web"
// case: the rider must still be able to take the photo by hand.
describe('FaceAutoCapture without face detection', () => {
    it('offers the Take photo button straight away', () => {
        const { getByText } = render(<FaceAutoCapture onCapture={jest.fn()} onCancel={jest.fn()} />);
        expect(getByText('Take photo')).toBeTruthy();
        expect(getByText(/tap Take photo/i)).toBeTruthy();
    });

    it('shows an upload error with Try again instead of retaking on its own', () => {
        const onRetry = jest.fn();
        const { getByText } = render(
            <FaceAutoCapture onCapture={jest.fn()} onCancel={jest.fn()} error="No connection right now." onRetry={onRetry} />,
        );
        expect(getByText('No connection right now.')).toBeTruthy();
        fireEvent.press(getByText('Try again'));
        expect(onRetry).toHaveBeenCalled();
    });
});
