import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  JoinWithCode: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Work: undefined;
  Catalog: undefined;
  Money: undefined;
  You: undefined;
};

export type AppStackParamList = {
  Main: undefined;
  Orders: undefined;
  Dispatch: undefined;
  Earnings: undefined;
  ProductCatalog: undefined;
  Appointments: undefined;
  PropertyManagement: { merchant_id?: string };
  EquityProgress: { contract_id?: string };
  Staff: undefined;
  NfcAcceptPayment: undefined;
  Brand: undefined;
  Promotions: undefined;
  AirportPickups: undefined;
  GSpot: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
