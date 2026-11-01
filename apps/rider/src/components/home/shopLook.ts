import type { Ionicons } from '@expo/vector-icons';
import type React from 'react';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// One colour + icon per kind of shop, shared by the map pin, the swipe card
// and the action card so a shop looks the same everywhere.
export function shopLook(storeType?: string | null, category?: string | null): { color: string; icon: IconName; label: string } {
    const t = `${storeType || ''} ${category || ''}`.toLowerCase();
    if (/grocery|market|supermarket/.test(t)) return { color: '#2FB57C', icon: 'cart', label: 'Groceries' };
    if (/pharm|drug|health/.test(t)) return { color: '#FF5C8A', icon: 'medkit', label: 'Pharmacy' };
    if (/restaurant|food|cafe|café|bakery|bar|doubles|roti/.test(t)) return { color: '#FF8A3D', icon: 'fast-food', label: 'Food' };
    if (/laundry|clean/.test(t)) return { color: '#3FD9E8', icon: 'shirt', label: 'Laundry' };
    return { color: '#8B7CFF', icon: 'storefront', label: 'Shop' };
}

export function formatDistance(m?: number | null): string {
    if (m == null || !Number.isFinite(m)) return '';
    return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
