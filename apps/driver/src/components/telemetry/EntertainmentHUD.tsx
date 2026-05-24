import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ghostBorder, tokens } from './designTokens';

interface EntertainmentHUDProps {
  url: string;
  onAccept?: () => void;
  onReject?: () => void;
}

export function EntertainmentHUD({ url, onAccept, onReject }: EntertainmentHUDProps) {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
  const isSpotify = url.includes('spotify.com');
  const source = isYoutube ? 'YOUTUBE' : isSpotify ? 'SPOTIFY' : 'MEDIA';

  return (
    <View style={s.container}>
      <Ionicons name="musical-notes-outline" size={18} color={tokens.colors.cyan} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.label}>RIDER SUGGESTION</Text>
        <Text style={s.source} numberOfLines={1}>{source}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {onReject && (
          <TouchableOpacity style={s.rejectBtn} onPress={onReject} activeOpacity={0.7}>
            <Ionicons name="close" size={14} color={tokens.colors.textMuted} />
          </TouchableOpacity>
        )}
        {onAccept && (
          <TouchableOpacity style={s.acceptBtn} onPress={onAccept} activeOpacity={0.7}>
            <Ionicons name="checkmark" size={14} color={tokens.colors.bg} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,229,255,0.04)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    ...ghostBorder(0.12),
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    color: tokens.colors.cyan,
    letterSpacing: 1.5,
  },
  source: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.colors.text,
    marginTop: 2,
  },
  acceptBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: tokens.colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: tokens.colors.containerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
});
