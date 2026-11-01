import { createNavigationContainerRef } from '@react-navigation/native';

// Lets code outside a screen (the notification tap router) move the app.
export const navigationRef = createNavigationContainerRef<any>();
