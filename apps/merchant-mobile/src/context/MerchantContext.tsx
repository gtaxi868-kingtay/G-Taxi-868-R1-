import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { initializeSupabaseClient } from '@gtaxi/core';
import { useAuth } from './AuthContext';
import { businessTypeFor, type BusinessType, type BusinessTypeKey } from '../business/businessTypes';

const { supabase } = initializeSupabaseClient('native');

export type Merchant = {
    id: string;
    name: string;
    category: string | null;
    business_type: string | null;
    address: string | null;
    cover_image_url: string | null;
    is_open: boolean | null;
    is_active: boolean | null;
    activation_status: string | null;
    created_by: string | null;
};

type MerchantState = {
    merchant: Merchant | null;
    type: BusinessType | null;
    isOwner: boolean;
    loading: boolean;
    failed: boolean;
    reload: () => Promise<void>;
    setOpen: (open: boolean) => Promise<boolean>;
    setBusinessType: (key: BusinessTypeKey) => Promise<boolean>;
};

const MerchantContext = createContext<MerchantState | null>(null);

const COLUMNS = 'id, name, category, business_type, address, cover_image_url, is_open, is_active, activation_status, created_by';

export function MerchantProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [merchant, setMerchant] = useState<Merchant | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const reload = useCallback(async () => {
        if (!user) { setMerchant(null); setLoading(false); return; }
        setFailed(false);
        const owned = await supabase.from('merchants').select(COLUMNS).eq('created_by', user.id).maybeSingle();
        if (owned.data) { setMerchant(owned.data as Merchant); setLoading(false); return; }
        const staff = await supabase.from('merchant_staff').select('merchant_id').eq('user_id', user.id).maybeSingle();
        if (staff.data?.merchant_id) {
            const row = await supabase.from('merchants').select(COLUMNS).eq('id', staff.data.merchant_id).maybeSingle();
            setMerchant((row.data as Merchant) ?? null);
            setFailed(!!row.error);
        } else {
            setFailed(!!owned.error || !!staff.error);
        }
        setLoading(false);
    }, [user?.id]);

    useEffect(() => { reload(); }, [reload]);

    const setOpen = useCallback(async (open: boolean) => {
        if (!merchant) return false;
        const previous = merchant.is_open;
        setMerchant({ ...merchant, is_open: open });
        const { data, error } = await supabase.rpc('merchant_set_open', { p_merchant_id: merchant.id, p_is_open: open });
        if (error || !data?.success) { setMerchant({ ...merchant, is_open: previous }); return false; }
        return true;
    }, [merchant]);

    const setBusinessType = useCallback(async (key: BusinessTypeKey) => {
        if (!merchant) return false;
        const { data, error } = await supabase.rpc('merchant_set_business_type', { p_merchant_id: merchant.id, p_type: key });
        if (error || !data?.success) return false;
        setMerchant({ ...merchant, business_type: key });
        return true;
    }, [merchant]);

    const value = useMemo(() => ({
        merchant,
        type: businessTypeFor(merchant),
        isOwner: !!merchant && merchant.created_by === user?.id,
        loading, failed, reload, setOpen, setBusinessType,
    }), [merchant, user?.id, loading, failed, reload, setOpen, setBusinessType]);

    return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant() {
    const ctx = useContext(MerchantContext);
    if (!ctx) throw new Error('useMerchant must be inside MerchantProvider');
    return ctx;
}
