import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type ActiveTripParams = {
  rideId?: string;
};

export type AppStackParamList = {
  Dashboard: undefined;
  PendingApproval: undefined;
  TripRequest: undefined;
  ActiveTrip: ActiveTripParams;
  Earnings: undefined;
  Wallet: undefined;
  ScheduledRides: undefined;
  Profile: undefined;
  Chat: {
    rideId?: string;
    rider?: {
      id: string;
      name: string;
      phone?: string;
    };
  };
  StrategySettings: undefined;
  Legal: undefined;
  ReportIssue: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
