// True when the screen is showing as a bottom tab (Trips, Wallet) rather than
// pushed onto the stack. A tab has no "back" — the tab bar is the way out — so
// those screens hide their back button in that case. When the same screen is
// pushed (e.g. Wallet opened from a payment), it keeps the back button.
export function useInTab(navigation: any): boolean {
    try {
        return navigation?.getState?.()?.type === 'tab';
    } catch {
        return false;
    }
}
