# Driver App Neumorphic Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept the Stitch failure and manually execute a flawless React Native Neumorphic Light mode rewrite of the Driver App's Dashboard Screen, incorporating exact branding and physical UI shadowing constraints.

**Architecture:** We will replace the overarching App/Screen constants (`C`) in `DashboardScreen.tsx` to match the `#E5E9F0` grey base. We will implement React Native elevation and box-shadow layers to create the extruded `SoftCard` effect. The MapBox URL will be swapped to a light/day variant to maintain the aesthetic. Finally, the G-Taxi logo will be rendered prominently.

**Tech Stack:** React Native (Expo), StyleSheet, Mapbox (React Native Maps), Expo Haptics.

---

### Task 1: Re-Theme the Dashboard Constants

**Files:**
- Modify: `/Users/kingtay/Desktop/g taxi rider/apps/driver/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Replace the color constants (`C`)**
  Update lines ~35-53 to implement the exact Neumorphic Light theme.

```typescript
const C = {
    bg: '#E5E9F0', // Physical clay base
    surface: '#E5E9F0',
    surfaceHigh: '#FFFFFF',
    border: '#B8C2D1', // shadowDark equivalent
    borderActive: '#06B6D4', // G-Taxi Cyan
    purple: '#111827', // Pitch black for primary actions
    purpleLight: '#374151',
    purpleDim: 'rgba(17,24,39,0.08)',
    gold: '#F59E0B',
    goldDim: 'rgba(245,158,11,0.12)',
    green: '#10B981',
    greenDim: 'rgba(16,185,129,0.12)',
    red: '#EF4444',
    redDim: 'rgba(239,68,68,0.12)',
    white: '#111827', // Invert text colors for light UI
    muted: '#6B7280',
    faint: 'rgba(0,0,0,0.05)',
    // Added shadow tokens for Neumorphism
    shadowLight: '#FFFFFF',
    shadowDark: '#B8C2D1'
};
```

### Task 2: Implement the G-Taxi Logo and Map Layer

**Files:**
- Modify: `/Users/kingtay/Desktop/g taxi rider/apps/driver/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Swap Mapbox Tile Layer to Light Mode**
Change `dark-v11` to `light-v11` in the `UrlTile` component.

```typescript
// Replace UrlTile urlTemplate
<UrlTile
    urlTemplate={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${ENV.MAPBOX_PUBLIC_TOKEN}`}
    shouldReplaceMapContent={true}
    maximumZ={19}
    flipY={false}
/>
```

- [ ] **Step 2: Inject Logo into the Header/Map Overlay**
Add an `<Image />` component reading `require('../../assets/logo.png')` inside `s.mapOverlay` or equivalent top-safe area.

### Task 3: Inject Neumorphic Box Shadows into UI Elements

**Files:**
- Modify: `/Users/kingtay/Desktop/g taxi rider/apps/driver/src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Update existing styles in StyleSheet.create**
Target `panelOuter`, `statCard`, `quickCard` to use dual/heavy shadow offsets that simulate extrusion on the `#E5E9F0` background.

```typescript
// Update s.statCard
statCard: {
    borderRadius: 16, backgroundColor: C.surface, // no border width
    paddingVertical: 14, paddingHorizontal: 12, gap: 2,
    shadowColor: C.shadowDark, shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10, elevation: 6,
},
// Add inner glow representation using border on the card
```
