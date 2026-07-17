// Web stub for @stripe/stripe-react-native.
// The real package is native-only (deep-imports react-native internals like
// Libraries/Components/TextInput/TextInputState, which crashes Metro's web bundler).
// This stub lets rider/driver bundle for web preview — payment sheet calls resolve
// with an unavailable error instead of charging. Native builds never touch this file.

export function StripeProvider({ children }) {
  return children;
}

const unavailable = { code: 'WebPreview', message: 'Stripe native SDK is unavailable on web preview' };

export function useStripe() {
  return {
    initPaymentSheet: async () => ({ error: unavailable }),
    presentPaymentSheet: async () => ({ error: unavailable }),
    confirmPayment: async () => ({ error: unavailable }),
    confirmSetupIntent: async () => ({ error: unavailable }),
    createPaymentMethod: async () => ({ error: unavailable }),
    retrievePaymentIntent: async () => ({ error: unavailable }),
    handleNextAction: async () => ({ error: unavailable }),
  };
}

export default { StripeProvider, useStripe };
