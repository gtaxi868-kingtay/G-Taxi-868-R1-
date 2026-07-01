import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, {
  useSharedValue, withRepeat, withTiming, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import { GlassCard } from '@gtaxi/design-system/native';
import { VOICES } from '@gtaxi/design-system';

const ReanimatedTouchable = Reanimated.createAnimatedComponent(TouchableOpacity);

function ScalePress({ children, onPress, style, ...rest }: any) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <ReanimatedTouchable
      onPressIn={() => { scale.value = withSpring(0.96, { damping: 15, stiffness: 200, mass: 0.5 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 200, mass: 0.5 }); }}
      onPress={onPress}
      style={[animStyle, style]}
      activeOpacity={1}
      {...rest}
    >
      {children}
    </ReanimatedTouchable>
  );
}

interface AIAssistantWidgetProps {
  onMicPress?: () => void;
  onSearchPress?: () => void;
  onSubmitText?: (text: string) => void;
  placeholder?: string;
  greeting?: string;
  isLoading?: boolean;
}

export function AIAssistantWidget({ onMicPress, onSearchPress, onSubmitText, placeholder, greeting, isLoading }: AIAssistantWidgetProps) {
  const pulse = useSharedValue(0);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1500 }), -1, true);
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.6,
    transform: [{ scale: 0.9 + pulse.value * 0.15 }],
  }));

  const waveformStyle = useAnimatedStyle(() => ({
    height: 12 + pulse.value * 10,
  }));

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmitText?.(trimmed);
  }, [text, onSubmitText]);

  const handleMicPress = useCallback(() => {
    onMicPress?.();
  }, [onMicPress]);

  return (
    <GlassCard style={s.container}>
      <View style={s.row}>
        <Reanimated.View style={[s.iconWrap, pulseStyle]}>
          <Ionicons name="hardware-chip-sharp" size={22} color={VOICES.rider.accent} />
        </Reanimated.View>

        <View style={s.contentWrap}>
          {greeting ? (
            <Text style={s.greeting} numberOfLines={1}>{greeting}</Text>
          ) : null}
          <TextInput
            ref={inputRef}
            style={s.input}
            placeholder={placeholder || "Where to? (e.g., 'Take me to the base, then stop by the market...')"}
            placeholderTextColor="rgba(255,255,255,0.35)"
            editable={!isLoading}
            value={text}
            onChangeText={setText}
            onSubmitEditing={handleSubmit}
            returnKeyType="search"
          />
        </View>

        {isLoading ? (
          <View style={s.micWrap}>
            <ActivityIndicator size="small" color={VOICES.rider.accent} />
          </View>
        ) : (
          <ScalePress onPress={handleMicPress} style={s.micWrap}>
            <View style={s.waveformGroup}>
              <Reanimated.View style={[s.waveformBar, { height: 12 }, waveformStyle]} />
              <Reanimated.View style={[s.waveformBar, s.waveformMid, waveformStyle]} />
              <Reanimated.View style={[s.waveformBar, waveformStyle]} />
            </View>
            <Ionicons name="mic" size={20} color={VOICES.rider.accent} />
          </ScalePress>
        )}
      </View>
    </GlassCard>
  );
}

const s = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(52,230,236,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentWrap: {
    flex: 1,
  },
  greeting: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  input: {
    fontSize: 15,
    fontWeight: '500',
    color: '#EAF3F6',
    padding: 0,
    margin: 0,
  },
  micWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(52,230,236,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(91,240,245,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
    shadowColor: '#34E6EC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  waveformGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: 4,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: VOICES.rider.accent,
  },
  waveformMid: {
    height: 16,
  },
});
