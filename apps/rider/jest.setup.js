jest.mock('@react-native-community/netinfo', () => ({
    useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
    fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
}));
