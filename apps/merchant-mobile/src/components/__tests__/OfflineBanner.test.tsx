import { bannerText } from '../OfflineBanner';

describe('OfflineBanner text', () => {
  it('says plainly that nothing saves while offline', () => {
    expect(bannerText(false, false)).toBe("You're offline. Changes won't save until you reconnect.");
  });
  it('confirms when the connection is back, and is quiet otherwise', () => {
    expect(bannerText(true, true)).toBe('Back online.');
    expect(bannerText(true, false)).toBeNull();
    expect(bannerText(null, false)).toBeNull();
  });
});
