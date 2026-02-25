module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Removed react-native-maps alias that was breaking native builds
        ],
    };
};
