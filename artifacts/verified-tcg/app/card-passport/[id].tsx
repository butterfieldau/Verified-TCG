import React, { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { CardImage } from '@/components/ui/CardImage';
import CollectionHoldingsPanel from '@/components/ui/CollectionHoldingsPanel';
import colors from '@/constants/colors';
import { getCardPassport } from '@/services/matching';
import { catalogCardToAppCard, fetchCatalogCard } from '@/services/catalogApi';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import type { Card } from '@/types';

const C = colors.dark;

const EVENT_ICON: Record<string, string> = {
  added: 'plus-circle',
  listed: 'tag',
  traded: 'repeat',
  graded: 'award',
  verified: 'shield',
};
const EVENT_COLOR: Record<string, string> = {
  added: '#3B82F6',
  listed: '#F59E0B',
  traded: '#22C55E',
  graded: '#D4AF37',
  verified: '#22C55E',
};

export default function CardPassportScreen() {
  const insets = useSafeAreaInsets();
  const { collection } = useApp();
  const { currency: displayCurrency } = useSettings();
  const { id, appCardJson } = useLocalSearchParams<{ id: string; appCardJson?: string }>();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const passport = getCardPassport(id ?? '');
  const inlineCard = useMemo<Card | null>(() => {
    if (!appCardJson) return null;
    try {
      return JSON.parse(appCardJson) as Card;
    } catch {
      return null;
    }
  }, [appCardJson]);
  const collectionCard = useMemo(
    () => collection.find(item => item.cardId === id)?.card ?? null,
    [collection, id],
  );
  const [remoteCard, setRemoteCard] = useState<Card | null>(null);
  const [cardLoading, setCardLoading] = useState(!inlineCard && !collectionCard);
  const [cardError, setCardError] = useState<string | null>(null);
  const card = collectionCard ?? inlineCard ?? remoteCard;

  useEffect(() => {
    if (!id || inlineCard || collectionCard) {
      setCardLoading(false);
      return;
    }
    const controller = new AbortController();
    setCardLoading(true);
    setCardError(null);
    fetchCatalogCard(id, controller.signal, displayCurrency)
      .then(result => {
        if (!result) {
          setCardError('This card could not be found.');
          return;
        }
        setRemoteCard(catalogCardToAppCard(result));
      })
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setCardError('The live card record could not be loaded.');
      })
      .finally(() => setCardLoading(false));
    return () => controller.abort();
  }, [id, inlineCard, collectionCard, displayCurrency]);

  if (!card) {
    return (
      <View style={[styles.missingScreen, { paddingTop: topPad }]}>
        <Feather name={cardLoading ? 'loader' : 'book-open'} size={40} color={C.mutedForeground} />
        <Text style={styles.missingTitle}>{cardLoading ? 'Loading Card Passport' : 'Card Passport unavailable'}</Text>
        <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', paddingHorizontal: 40 }}>
          {cardLoading ? 'Connecting to the live card record…' : cardError ?? 'The live card record is unavailable.'}
        </Text>
        {!cardLoading && <Pressable onPress={() => router.back()} style={{ marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card }}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground }}>Go Back</Text>
        </Pressable>}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 60 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Card Passport</Text>
        <Pressable style={styles.backBtn}>
          <Feather name="share-2" size={18} color={C.foreground} />
        </Pressable>
      </View>

      {/* Hero card */}
      <View style={[styles.heroCard, { backgroundColor: card.gradientStart }]}>
        <View style={styles.heroInner}>
          <Text style={styles.heroInitial}>{card.name[0]}</Text>
        </View>
        {!!card.imageUrl && (
          <CardImage
            uri={card.imageUrl}
            resizeWidth={1000}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel={`${card.name} card image`}
          />
        )}
        {/* Passport badge */}
        <View style={[styles.passportBadge, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
          <Feather name="book-open" size={10} color="#FFFFFF" />
          <Text style={styles.passportBadgeText}>CARD PASSPORT</Text>
        </View>
      </View>

      {/* Card identity */}
      <View style={[styles.identityCard, { backgroundColor: C.card }]}>
        <Text style={styles.cardName}>{card.name}</Text>
        <Text style={styles.cardSet}>{card.setName} · {card.number}</Text>
        {passport && <View style={styles.identityRow}>
          <View style={[styles.gradePill, { backgroundColor: '#FF1E2D22' }]}>
            <Text style={[styles.gradePillText, { color: '#FF1E2D' }]}>
              {passport.gradingCompany} {passport.grade}
            </Text>
          </View>
          <View style={[styles.certPill, { backgroundColor: C.muted }]}>
            <Feather name="hash" size={10} color={C.mutedForeground} />
            <Text style={styles.certPillText}>{passport.certNumber}</Text>
          </View>
        </View>}
      </View>

      <CollectionHoldingsPanel card={card} />

      {/* Grading details */}
      {passport && <View style={[styles.section, { backgroundColor: C.card }]}>
        <Text style={styles.sectionTitle}>GRADING RECORD</Text>
        <View style={styles.detailRows}>
          <DetailRow label="Grading Company" value={passport.gradingCompany} />
          <DetailRow label="Grade" value={String(passport.grade)} highlight />
          <DetailRow label="Certification Number" value={passport.certNumber} />
          <DetailRow label="Graded On" value={new Date(passport.gradedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} />
          <DetailRow label="Population (PSA Pop)" value={`${passport.population.toLocaleString()} graded at this level`} />
        </View>
      </View>}

      {/* Purchase / Transaction history */}
      {passport && <View style={[styles.section, { backgroundColor: C.card }]}>
        <Text style={styles.sectionTitle}>TRANSACTION HISTORY</Text>
        {passport.purchaseHistory.map(tx => (
          <View key={tx.id} style={[styles.txRow, { borderBottomColor: C.border }]}>
            <View style={[styles.txIcon, {
              backgroundColor: tx.type === 'purchase' ? `${C.positive}22`
                : tx.type === 'sale' ? `${C.primary}22`
                : '#3B82F622',
            }]}>
              <Feather
                name={tx.type === 'purchase' ? 'arrow-down-circle' : tx.type === 'sale' ? 'arrow-up-circle' : 'repeat'}
                size={14}
                color={tx.type === 'purchase' ? C.positive : tx.type === 'sale' ? C.primary : '#3B82F6'}
              />
            </View>
            <View style={styles.txInfo}>
              <Text style={styles.txType}>
                {tx.type === 'purchase' ? `Purchased from ${tx.from ?? 'unknown'}` :
                 tx.type === 'sale' ? `Sold to ${tx.to ?? 'unknown'}` :
                 'Trade'}
              </Text>
              <View style={styles.txMeta}>
                <Text style={styles.txDate}>{new Date(tx.date).toLocaleDateString('en-AU')}</Text>
                <Text style={styles.txPlatform}>· {tx.platform}</Text>
                {tx.verifiedOnChain && (
                  <View style={[styles.onChainBadge, { backgroundColor: `${C.positive}22` }]}>
                    <Feather name="check" size={8} color={C.positive} />
                    <Text style={[styles.onChainText, { color: C.positive }]}>Verified</Text>
                  </View>
                )}
              </View>
            </View>
            {tx.price && (
              <Text style={styles.txPrice}>${tx.price.toLocaleString('en-AU')}</Text>
            )}
          </View>
        ))}
      </View>}

      {/* Verified TCG history */}
      {passport && <View style={[styles.section, { backgroundColor: C.card }]}>
        <Text style={styles.sectionTitle}>VERIFIED TCG HISTORY</Text>
        {passport.verifiedTCGHistory.map((event, idx) => (
          <View key={event.id} style={styles.timelineRow}>
            <View style={styles.timelineLeft}>
              <View style={[styles.timelineIcon, {
                backgroundColor: `${EVENT_COLOR[event.type] ?? C.primary}22`,
              }]}>
                <Feather
                  name={EVENT_ICON[event.type] as any ?? 'circle'}
                  size={12}
                  color={EVENT_COLOR[event.type] ?? C.primary}
                />
              </View>
              {idx < passport.verifiedTCGHistory.length - 1 && (
                <View style={[styles.timelineLine, { backgroundColor: C.border }]} />
              )}
            </View>
            <View style={styles.timelineContent}>
              <Text style={styles.timelineDesc}>{event.description}</Text>
              <Text style={styles.timelineDate}>
                {new Date(event.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </View>
          </View>
        ))}
      </View>}

      {/* Photos placeholder */}
      {passport && <View style={[styles.section, { backgroundColor: C.card }]}>
        <Text style={styles.sectionTitle}>PHOTOS</Text>
        <View style={styles.photosRow}>
          {['Front', 'Back', 'Case'].map(label => (
            <View key={label} style={[styles.photoSlot, { backgroundColor: C.muted }]}>
              <Feather name="image" size={20} color={C.mutedForeground} />
              <Text style={styles.photoLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.photoNote}>
          High-resolution photos stored with this passport record.
        </Text>
      </View>}
    </ScrollView>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && { color: '#D4AF37', fontSize: 18, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  missingScreen: { flex: 1, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  missingTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  content: { paddingHorizontal: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  heroCard: {
    height: 220, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative',
  },
  heroInner: { alignItems: 'center', justifyContent: 'center' },
  heroInitial: { fontSize: 96, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.25)' },
  passportBadge: {
    position: 'absolute', bottom: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  passportBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 1 },
  identityCard: { borderRadius: 16, padding: 18, gap: 10 },
  cardName: { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.foreground },
  cardSet: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  identityRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  gradePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  gradePillText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  certPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  certPillText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  section: { borderRadius: 16, padding: 18, gap: 14 },
  sectionTitle: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  detailRows: { gap: 12 },
  detailRow: { gap: 3 },
  detailLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  detailValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  ownerAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  ownerAvatarText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFF' },
  ownerInfo: { flex: 1 },
  ownerHandle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  ownerSince: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  ownerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  ownerBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  disclaimer: { flexDirection: 'row', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  disclaimerText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  txIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1, gap: 4 },
  txType: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  txMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  txDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  txPlatform: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  onChainBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  onChainText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  txPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLeft: { alignItems: 'center', width: 32 },
  timelineIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  timelineLine: { width: 2, flex: 1, marginTop: 4, marginBottom: -4 },
  timelineContent: { flex: 1, paddingBottom: 16, gap: 4 },
  timelineDesc: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground, lineHeight: 20 },
  timelineDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  photosRow: { flexDirection: 'row', gap: 10 },
  photoSlot: { flex: 1, height: 90, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  photoNote: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}77`, lineHeight: 17 },
});
