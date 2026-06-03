// @gtaxi/shared — Relay barrel
// This package re-exports from @gtaxi/core and @gtaxi/native for
// backward-compatibility with import paths used in apps/rider.
export * from '@gtaxi/core';
export * from '../OutboxService';
export * from './RideEngine.shadow';
export * from './FinancialLedger.shadow';
export * from './AIGateway.shadow';
export * from '../env';
export { ErrorBoundary } from './ErrorBoundary';
