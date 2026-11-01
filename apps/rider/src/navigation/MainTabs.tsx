import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GTabBar } from '../components/GTabBar';
import { HomeScreen } from '../screens/HomeScreen';
import { ServicesScreen } from '../screens/ServicesScreen';
import { TripsScreen } from '../screens/TripsScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { YouScreen } from '../screens/YouScreen';
import { useTheme } from '../ui/kit';
import type { AppScreenProps, MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// The rider's five tabs, replacing the old hamburger drawer. Mounted as the
// stack route "Home", so navigate('Home') and reset-to-Home keep working
// everywhere; navigate('Home', { screen: 'Map' }) picks the map tab.
//
// The tab bar is drawn in normal layout flow below the screens (not floating),
// so no screen content can ever sit underneath it.
export function MainTabs({ route }: AppScreenProps<'Home'>) {
    const m = useTheme();
    // Web design gallery only: /design-preview/screens?s=Services opens that tab.
    const initialTab = (route?.params as any)?.initialTab as keyof MainTabParamList | undefined;
    return (
        <Tab.Navigator
            initialRouteName={initialTab || 'Map'}
            tabBar={(props) => <GTabBar {...props} />}
            backBehavior="firstRoute"
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: m.page } }}
        >
            <Tab.Screen name="Map" component={HomeScreen} />
            <Tab.Screen name="Services" component={ServicesScreen} />
            <Tab.Screen name="Activity" component={TripsScreen} />
            <Tab.Screen name="WalletTab" component={WalletScreen} />
            <Tab.Screen name="You" component={YouScreen as any} />
        </Tab.Navigator>
    );
}
