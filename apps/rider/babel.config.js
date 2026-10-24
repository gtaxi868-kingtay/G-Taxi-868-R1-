module.exports = function (api) {
  // Tests run without NativeWind: its JSX rewrite breaks jest.mock() factories
  // in jest.setup.js ("module factory ... out-of-scope variables"). Screens
  // style themselves with the ui/kit, so tests lose nothing.
  const isTest = api.env('test');
  api.cache.using(() => isTest);

  return {
    // NativeWind: className styling (Tailwind) on React Native components.
    presets: isTest
      ? ['babel-preset-expo']
      : [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      ['module-resolver', {
        alias: {
          '@': './src',
        },
      }],
    ],
  };
};
