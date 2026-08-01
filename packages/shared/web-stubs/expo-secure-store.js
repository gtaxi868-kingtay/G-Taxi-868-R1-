// Web stub for expo-secure-store.
// @gtaxi/core's getStorage() does `require('expo-secure-store')` behind a runtime
// `navigator.product === 'ReactNative'` check that's always false on web — but esbuild's
// dependency optimizer resolves require() literals statically regardless of that guard,
// pulling in the real native module (which imports react-native, Flow syntax, crashes
// esbuild). This stub satisfies that static resolution; the real functions are never
// called on web since the runtime guard skips them.
async function getItemAsync() { return null; }
async function setItemAsync() {}
async function deleteItemAsync() {}

module.exports = { getItemAsync, setItemAsync, deleteItemAsync };
module.exports.default = module.exports;
