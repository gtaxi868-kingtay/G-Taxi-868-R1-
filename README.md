# G-Taxi Rider App

Uber-standard ride-hailing app for Trinidad & Tobago.

## Setup

```bash
npm install
```

## Run

```bash
# Start Expo dev server
npm start

# Run on web (preview in browser)
npm run web

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Architecture

- **Frontend**: Expo (React Native) + TypeScript
- **Backend**: Supabase Edge Functions
- **Maps**: Mapbox
- **Database**: Supabase Postgres

## Screens

1. Home - Map with "Where to?" button
2. Destination Search - Search for destinations
3. Ride Confirmation - View fare and confirm
4. Searching Driver - Animated searching state
5. Active Ride - Driver info and trip progress
6. Rating - Rate driver after trip

## Server Authority

ALL business logic runs in Supabase Edge Functions:
- Price calculation
- Ride state management
- Driver matching

The frontend only displays server state. No client-side calculations allowed.
