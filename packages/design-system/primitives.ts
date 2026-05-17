// Relay: @gtaxi/design-system/primitives
// Metro resolves this sub-path to packages/design-system/primitives.ts (filesystem)
// Actual Txt component lives in design-system-native/src/components.tsx
// but the canonical local definition is in apps/rider/src/design-system/primitives.tsx
// This relay covers the workspace-package import side.
export * from '@gtaxi/design-system-native';
