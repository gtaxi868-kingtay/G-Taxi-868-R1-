import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AppStackParamList = {
  Dashboard: undefined;
  TagMarker: undefined;
  RegisterPuck: undefined;
  RevshareSettlement: undefined;
  CommanderManagement: undefined;
  Intelligence: undefined;
  Approvals: undefined;
  GroundTransit: undefined;
  ZoneRates: undefined;
  PlatformControl: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
