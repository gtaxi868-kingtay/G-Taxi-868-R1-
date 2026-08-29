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
  TripRequest: { rideId: string; offer: any };
  ActiveTrip: ActiveTripParams;
  DeliveryRequest: { orderId: string; offer: any };
  ActiveDelivery: { orderId: string };
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
  Ratings: undefined;
  ScoutReferral: undefined;
  DriverReferral: undefined;
  VehicleSales: undefined;
  Lease: undefined;
  LeaseConsent: undefined;
  GGarage: undefined;
  CommanderDashboard: undefined;
  CommanderConsole: undefined;
  CommanderRegisterNode: undefined;
  BecomeCommander: undefined;
  CashWithdrawal: undefined;
  RedeemCashCode: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
