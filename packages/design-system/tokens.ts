import { BRAND, SEMANTIC, VOICES } from '@gtaxi/design-system-native';

export const tokens = {
  colors: {
    background: {
      base: VOICES.driver.bg,
      ambient: '#1A1823',
    },
    text: {
      primary: VOICES.driver.text,
      secondary: '#AEA9B5',
      inverse: BRAND.deepViolet,
    },
    border: {
      subtle: 'rgba(119, 116, 127, 0.15)',
    },
    primary: {
      purple: BRAND.purple,
    },
    status: {
      error: '#FF6E84',
    },
  },
};

export * from '@gtaxi/design-system-native';
