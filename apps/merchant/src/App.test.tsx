import { describe, it, expect } from 'vitest';

describe('Merchant App', () => {
  it('should export App component', async () => {
    const mod = await import('./App');
    expect(mod.default).toBeDefined();
  }, 30000); // first import pulls in the whole app; slow on a busy CI runner

  it('should have a React element type as default export', async () => {
    const mod = await import('./App');
    const AppComponent: React.ComponentType<any> = mod.default;
    expect(typeof AppComponent).toBe('function');
  });
});
