import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type AppStackParamList = {
  Dashboard: undefined;
  Orders: undefined;
  Dispatch: undefined;
  Earnings: undefined;
  ProductCatalog: undefined;
  Appointments: undefined;
  PropertyManagement: { merchant_id?: string };
  EquityProgress: { contract_id?: string };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
