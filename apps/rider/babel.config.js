module.exports = function (api) {
  api.cache(true);

  return {
    // NativeWind: className styling (Tailwind) on React Native components.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      ['module-resolver', {
        alias: {
          '@': './src',
        },
      }],
    ],
  };
};
