export function elevationGlow(_elevation?: number) {
  return {
    shadowColor: '#00FFFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  };
}

export function ghostBorder(opacity = 0.15) {
  return {
    borderWidth: 1,
    borderColor: `rgba(255, 255, 255, ${opacity})`,
  };
}

// backdropFilter is CSS-only and silently ignored on Android React Native.
// We achieve the premium-dark feel with a rich tinted substrate instead.
// Callers that need true blur on iOS should use expo-blur's BlurView directly.
export function glassSurface(_blurIntensity = 20, opacity = 0.2) {
  const flooredOpacity = Math.max(opacity, 0.72);
  return {
    backgroundColor: `rgba(6, 10, 12, ${flooredOpacity})`,
    overflow: 'hidden' as const,
  };
}
