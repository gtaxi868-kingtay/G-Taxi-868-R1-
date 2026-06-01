import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type AuthStackParamList = {
  Login: undefined;
};

export type AppStackParamList = {
  Dashboard: undefined;
  TagMarker: undefined;
  RegisterPuck: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;
export type AppScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<AppStackParamList, T>;
