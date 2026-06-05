import { describe, it, expect } from 'vitest';

describe('Merchant App', () => {
  it('should export App component', async () => {
    const mod = await import('./App');
    expect(mod.default).toBeDefined();
  });

  it('should have a React element type as default export', async () => {
    const mod = await import('./App');
    const AppComponent: React.ComponentType<any> = mod.default;
    expect(typeof AppComponent).toBe('function');
  });
});
