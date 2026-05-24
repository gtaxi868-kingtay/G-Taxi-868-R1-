import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ACTION, COLORS, ghostBorder, elevationGlow, tokens } from './designTokens';
import { ScalePress } from './ScalePress';

interface ActionFooterProps {
  status: string;
  hasDelivery: boolean;
  hasMerchantPhoto: boolean;
  onOpenNavigation?: () => void;
  onArrived?: () => void;
  onVerifyPickup?: () => void;
  onComplete?: () => void;
  onDeliveryConfirmPickup?: () => void;
}

export function ActionFooter({
  status,
  hasDelivery,
  hasMerchantPhoto,
  onOpenNavigation,
  onArrived,
  onVerifyPickup,
  onComplete,
  onDeliveryConfirmPickup,
}: ActionFooterProps) {
  const isEnRoute = status === 'assigned';
  const isArrived = status === 'arrived';
  const isInProgress = status === 'in_progress';

  const renderPrimary = () => {
    if (isEnRoute && onArrived) {
      return (
        <ScalePress style={[s.primaryBtn, { backgroundColor: COLORS.success }]} onPress={onArrived}>
          <Ionicons name="location-outline" size={18} color={tokens.colors.bg} />
          <Text style={s.primaryBtnText}>{hasDelivery ? "ARRIVED AT MERCHANT" : "I'VE ARRIVED"}</Text>
        </ScalePress>
      );
    }
    if (isArrived && !hasDelivery && onVerifyPickup) {
      return (
        <ScalePress style={[s.primaryBtn, { backgroundColor: tokens.colors.cyan }]} onPress={onVerifyPickup}>
          <Ionicons name="shield-checkmark-outline" size={18} color={tokens.colors.bg} />
          <Text style={s.primaryBtnText}>VERIFY & PICKUP</Text>
        </ScalePress>
      );
    }
    if (isArrived && hasDelivery && onDeliveryConfirmPickup) {
      const ready = hasMerchantPhoto;
      return (
        <ScalePress
          style={[s.primaryBtn, { backgroundColor: ready ? tokens.colors.cyan : 'rgba(255,255,255,0.08)' }]}
          onPress={() => {
            if (!ready) { Alert.alert('PHOTO REQUIRED', 'Merchant must upload intake photo before pickup.'); return; }
            onDeliveryConfirmPickup();
          }}
        >
          <Ionicons name="cube-outline" size={18} color={ready ? tokens.colors.bg : tokens.colors.textMuted} />
          <Text style={[s.primaryBtnText, { color: ready ? tokens.colors.bg : tokens.colors.textMuted }]}>
            {ready ? 'CONFIRM PICKUP' : 'AWAITING PHOTO'}
          </Text>
        </ScalePress>
      );
    }
    if (isInProgress && onComplete) {
      return (
        <ScalePress style={[s.primaryBtn, { backgroundColor: COLORS.warning }]} onPress={onComplete}>
          <Ionicons name="flag-outline" size={18} color={tokens.colors.bg} />
          <Text style={s.primaryBtnText}>{hasDelivery ? "MARK DELIVERED" : "COMPLETE TRIP"}</Text>
        </ScalePress>
      );
    }
    return null;
  };

  return (
    <View style={s.container}>
      {onOpenNavigation && (
        <ScalePress style={s.navBtn} onPress={onOpenNavigation}>
          <LinearGradient colors={['rgba(0,255,255,0.2)', 'rgba(0,255,255,0.05)']} style={s.navBtnGradient}>
            <Ionicons name="navigate-outline" size={22} color={tokens.colors.cyan} />
          </LinearGradient>
        </ScalePress>
      )}
      {renderPrimary()}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: ACTION.gap,
  },
  navBtn: {
    width: ACTION.navButtonSize,
    height: ACTION.buttonHeight,
    borderRadius: ACTION.buttonRadius,
    overflow: 'hidden',
    ...ghostBorder(0.2),
  },
  navBtnGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,255,255,0.08)',
  },
  primaryBtn: {
    flex: 1,
    height: ACTION.buttonHeight,
    borderRadius: ACTION.buttonRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...elevationGlow(),
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: tokens.colors.bg,
    letterSpacing: 0.3,
  },
});
