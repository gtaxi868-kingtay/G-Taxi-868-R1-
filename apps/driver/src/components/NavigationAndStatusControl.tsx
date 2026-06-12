import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated from 'react-native-reanimated';
import {
  usePhaseAnimation, GlassCard, TelemetryHUD, PhaseTrack, WaitFeeDisplay,
  EntertainmentHUD, QuietRideBanner, LogisticsHud, RiderInfoCard,
  ActionFooter, StatusBadge, SOSButton,
} from './telemetry';
import { decodePolyline, haversineKm, riderDisplayName, etaMinutes } from './telemetry/geo';
import type { NavigationAndStatusControlProps } from './telemetry/types';

export function NavigationAndStatusControl(props: NavigationAndStatusControlProps) {
  const { ride, rider, location, orderItems = [], isQuietRide, hasMerchantPhoto,
    onArrived, onVerifyPickup, onComplete, onCancel, onSOS, onOpenNavigation, onChat, onCall,
    onDeliveryConfirmPickup, onEntertainmentAccept, onEntertainmentReject,
  } = props;
  const insets = useSafeAreaInsets();
  const { phaseIndex, cardAnimatedStyle, phaseBarAnimatedStyle } = usePhaseAnimation(ride?.status || '');
  const isCompleted = ride?.status === 'completed' || ride?.status === 'closed';

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (isCompleted || ride?.status === 'arrived') return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isCompleted, ride?.status]);

  const decodedCoords = useMemo(
    () => props.routeCoords?.length ? props.routeCoords : (ride?.route_geometry ? decodePolyline(ride.route_geometry) : []),
    [props.routeCoords, ride?.route_geometry],
  );
  const speedKmh = (location?.coords?.speed ?? 0) * 3.6;
  const distanceKm = useMemo(() => haversineKm(decodedCoords), [decodedCoords]);

  if (isCompleted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <StatusBadge status={ride?.status || ''} signalStatus={props.signalStatus} top={insets.top + 16} />
      <SOSButton onSOS={onSOS} onCancel={onCancel} top={insets.top + 12} />
      <Reanimated.View style={[s.cardOuter, cardAnimatedStyle]}>
        <GlassCard>
          <TelemetryHUD speedKmh={speedKmh} etaMinutes={etaMinutes(speedKmh, distanceKm)} distanceKm={distanceKm} elapsedMinutes={Math.floor(elapsed / 60)} />
          <PhaseTrack phaseBarAnimatedStyle={phaseBarAnimatedStyle} phaseIndex={phaseIndex} />
          {ride?.status === 'arrived' && ride?.arrived_at && <WaitFeeDisplay arrivedAt={ride.arrived_at} />}
          <LogisticsHud items={orderItems} />
          {isQuietRide && <QuietRideBanner />}
          {ride?.entertainment_url && ride?.entertainment_status === 'pending' && (
            <EntertainmentHUD url={ride.entertainment_url} onAccept={onEntertainmentAccept} onReject={onEntertainmentReject} />
          )}
          <RiderInfoCard name={riderDisplayName(rider)} paymentMethod={ride?.payment_method} onChat={onChat} onCall={onCall} />
          <ActionFooter
            status={ride?.status || ''} hasDelivery={!!ride?.order_id} hasMerchantPhoto={!!hasMerchantPhoto}
            onOpenNavigation={onOpenNavigation} onArrived={onArrived} onVerifyPickup={onVerifyPickup}
            onComplete={onComplete} onDeliveryConfirmPickup={onDeliveryConfirmPickup}
          />
        </GlassCard>
      </Reanimated.View>
    </View>
  );
}

const s = StyleSheet.create({
  cardOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
