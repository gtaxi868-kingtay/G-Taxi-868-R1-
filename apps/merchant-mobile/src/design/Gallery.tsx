import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthContext } from '../context/AuthContext';
import { MerchantContext, type Merchant } from '../context/MerchantContext';
import { businessTypeFor } from '../business/businessTypes';
import { MainTabs } from '../navigation/MainTabs';
import { PromotionsScreen } from '../screens/PromotionsScreen';
import { MoodProvider } from '../ui/mood';

// Design review only: /design-preview?type=food. The real tabs and screens, with
// the sample rows from sampleFetch. Nothing here ships to a phone.
const NAMES: Record<string, [string, string]> = {
    food: ['Roti Hut', 'Chaguanas Main Road'], beauty: ['Fresh Cuts Barbershop', 'Ariapita Avenue'], stays: ['Coco Reef Guest House', 'Crown Point, Tobago'],
    grocery: ['Mohammed Mini Mart', 'San Juan'], auto: ['Ramdeen Auto Works', 'Debe'],
};
const Stack = createNativeStackNavigator();

export function MerchantGallery() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('type') ?? 'food';
    const [name, address] = NAMES[key] ?? NAMES.food;
    const merchant: Merchant = {
        id: 'm-1', name, category: null, business_type: key, address,
        cover_image_url: null, is_open: true, is_active: params.get('review') ? false : true,
        activation_status: params.get('review') ? 'pending' : 'active', created_by: 'u-1',
    };
    const value = useMemo(() => ({
        merchant, type: businessTypeFor(merchant), isOwner: true, loading: false, failed: false,
        reload: async () => {}, setOpen: async () => true, setBusinessType: async () => true,
    }), [key]);
    const auth = useMemo(() => ({ user: { id: 'u-1' } as any, session: null, loading: false, signIn: async () => {}, signUp: async () => {}, signOut: async () => {} }), []);

    return (
        <AuthContext.Provider value={auth}>
            <MerchantContext.Provider value={value}>
                <MoodProvider force={params.get('mood') === 'day' ? 'day' : 'night'}>
                <NavigationContainer>
                    <Stack.Navigator screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="Main" component={MainTabs} />
                        <Stack.Screen name="Promotions" component={PromotionsScreen as any} />
                    </Stack.Navigator>
                </NavigationContainer>
                </MoodProvider>
            </MerchantContext.Provider>
        </AuthContext.Provider>
    );
}
