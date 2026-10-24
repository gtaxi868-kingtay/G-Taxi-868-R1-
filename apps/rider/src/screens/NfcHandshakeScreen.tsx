import React, { useEffect, useState, useCallback } from 'react';
import { View, Alert } from 'react-native';
import { supabase, OutboxService } from '@gtaxi/core';
import { toast } from '../components/Toast';
import { BrandBadge, Button, Chip, EmptyState, Screen, Section, SPACE, Txt, useTheme } from '../ui/kit';
import { describeNfcFailure, releaseNfc } from '../utils/nfcErrors';

const OUTBOX = OutboxService.getInstance();

export function NfcHandshakeScreen({ route, navigation }: any) {
  const { tagUid } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [handshake, setHandshake] = useState<any>(null);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  useEffect(() => {
    if (tagUid) {
      handleHandshake(tagUid);
    } else {
      scanNfcTag();
    }
  }, [tagUid]);

  const scanNfcTag = async () => {
    const mod = require('react-native-nfc-manager');
    const NfcManager = mod.default || mod;
    try {
      await NfcManager.start();
      await NfcManager.requestTechnology(NfcManager.Tech.NfcA);
      const tag = await NfcManager.getTag();
      await releaseNfc(NfcManager);
      if (tag?.id) {
        await handleHandshake(tag.id);
      } else {
        setLoading(false);
        toast('Could not read the tag. Hold your phone closer and try again.', 'error');
      }
    } catch {
      await releaseNfc(NfcManager);
      setLoading(false);
      const { title, message } = await describeNfcFailure(NfcManager);
      Alert.alert(title, message);
    }
  };

  const handleHandshake = useCallback(async (uid: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast('Please sign in to book from a tag.', 'error');
        setLoading(false);
        return;
      }

      const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      await OUTBOX.enqueueProofEvent({
        eventType: 'TAP_EVENT',
        tagUid: uid,
        userId: session.user.id,
        nonce,
        timestamp: new Date().toISOString(),
      });

      const { data, error } = await supabase.functions.invoke('nfc_event_handler', {
        body: { tag_uid: uid, profile_id: session.user.id, nonce },
      });

      if (error || data?.error) {
        toast(data?.error || error?.message || 'Could not connect to this G point.', 'error');
        setLoading(false);
        return;
      }

      setHandshake(data);
    } catch (error) {
      console.error('Handshake failed', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleService = (serviceId: string) => {
    setSelectedServices(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const confirmRide = () => {
    const pickup = {
      latitude: handshake.pickupCoords?.lat ?? handshake.pickupCoords?.latitude ?? 0,
      longitude: handshake.pickupCoords?.lng ?? handshake.pickupCoords?.longitude ?? 0,
      address: handshake.locationName || 'G-Taxi NFC Kiosk',
    };

    navigation.navigate('DestinationSearch', {
      currentLocation: pickup,
      source: 'nfc_kiosk',
      kioskId: handshake.kioskId,
      sourceMetadata: {
        kioskId: handshake.kioskId,
        locationName: handshake.locationName,
        selectedServices,
        tagUid,
      },
    });
  };

  const m = useTheme();

  if (loading) {
    return (
      <Screen scroll={false} onBack={() => navigation.goBack()} title="">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <BrandBadge icon="radio-outline" size={72} round />
          <Txt variant="title" style={{ marginTop: SPACE.xl }}>Connecting to this G point…</Txt>
          <Txt variant="body" tone="dim" style={{ marginTop: SPACE.xs }}>Hold on, this takes a second.</Txt>
        </View>
      </Screen>
    );
  }

  if (!handshake || handshake.type !== 'KIOSK_HANDSHAKE') {
    return (
      <Screen onBack={() => navigation.goBack()} title="">
        <EmptyState icon="alert-circle-outline" title="This tag is not a G pickup point"
          body="You can still book a ride from the home screen."
          action={
            <View style={{ gap: SPACE.md }}>
              <Button title="Try scanning again" onPress={() => { setLoading(true); scanNfcTag(); }} />
              <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} />
            </View>
          } />
      </Screen>
    );
  }

  return (
    <Screen
      onBack={() => navigation.goBack()}
      title=""
      hero={
        <View>
          <Txt variant="label" tone="accent">You tapped in at</Txt>
          <Txt variant="hero" style={{ marginTop: SPACE.xs }}>{handshake.locationName || 'G pickup point'}</Txt>
          {handshake.welcomeMessage ? <Txt variant="body" tone="dim" style={{ marginTop: SPACE.sm }}>{handshake.welcomeMessage}</Txt> : null}
        </View>
      }
      footer={<Button title="Choose where you're going" icon="navigate-outline" onPress={confirmRide} />}
    >
      {Array.isArray(handshake.availableServices) && handshake.availableServices.length > 0 && (
        <Section title="Add a stop on the way (optional)" style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {handshake.availableServices.map((service: any) => (
              <Chip key={service.id} icon={service.icon} label={service.name}
                selected={selectedServices.includes(service.id)} onPress={() => toggleService(service.id)} />
            ))}
          </View>
        </Section>
      )}
    </Screen>
  );
}
