module.exports = {
    preset: 'react-native',
    transformIgnorePatterns: [
        'node_modules/(?!(@react-native/|react-native/|expo/|expo-[^/]+/|@expo/|@unimodules/|unimodules/|expo-modules-core/|react-native-reanimated/|@react-navigation/|@stripe/|@gorhom/|@react-native-community/))',
    ],
    setupFiles: ['./jest.setup.js'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    testPathIgnorePatterns: ['/node_modules/', '/__tests__/.*\\.disabled\\..*$'],
};
