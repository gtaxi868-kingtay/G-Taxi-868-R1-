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

export function glassSurface(_blurIntensity = 20, opacity = 0.2) {
  return {
    backgroundColor: `rgba(5, 5, 5, ${opacity})`,
    backdropFilter: `blur(${_blurIntensity}px)` as unknown as undefined,
    overflow: 'hidden' as const,
  };
}
