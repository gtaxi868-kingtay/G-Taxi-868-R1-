import { useWindowDimensions, Platform, ScaledSize } from 'react-native';

const TABLET_BREAKPOINT = 768;
const CONTENT_MAX_WIDTH = 600;

export interface ResponsiveInfo {
  width: number;
  height: number;
  isTablet: boolean;
  isLandscape: boolean;
  contentWidth: number;
  scale: number;
}

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = width >= TABLET_BREAKPOINT;
  const contentWidth = isTablet ? CONTENT_MAX_WIDTH : width;
  const scale = Math.min(width / 390, 1.2);

  return {
    width,
    height,
    isTablet,
    isLandscape,
    contentWidth,
    scale,
  };
}
