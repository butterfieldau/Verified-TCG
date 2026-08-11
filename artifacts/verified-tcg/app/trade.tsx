import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { CollectionItem } from '@/types';
import { getTradeCounterpartyCards } from '@/services/trade';
import { MOCK_SMART_SELL_STATS } from '@/services/matching';

const C = colors.dark;

const THEIR_CARDS = getTradeCounterpartyCards();

type Step = 'select-offer' | 'select-receive' | 'review' | 'sent';

export default function TradeScreen() {
  const insets = useSafeAreaInsets();
  const { collection } = useApp();
  const [step, setStep] = useState<Step>('select-offer');
  const [myCardId, setMyCardId] = useState<string | null>(null);
  const [theirCardId, setTheirCardId] = useState<string | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const myItem = collection.find(i => i.id === myCardId);
  const theirCard = THEIR_CARDS.find(c => c.id === theirCardId);

  const myValue = myItem
    ? myItem.grading?.grade === 10
      ? myItem.card.price.psa10 ?? myItem.card.price.raw
      : myItem.card.price.raw
    : 0;
  const theirValue = theirCard?.value ?? 0;
  const diff = myValue - theirValue;

  function handleSendOffer() {
    setStep('sent');
  }

  if (step === 'sent') {
    return (
      <View style={[styles.screen, { backgroundColor: C.background, paddingTop: topPad }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: `${C.positive}22` }]}>
            <Feather name="repeat" size={44} color={C.positive} />
          </View>
          <Text style={styles.successTitle}>Trade Offer Sent!</Text>
          <Text style={styles.successBody}>
            Your trade offer has been sent to @cardvault_au.
            {'\n\n'}They have 48 hours to respond.
            {'\n\n'}(This is a prototype — no real offer was sent.)
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.successBtn, { backgroundColor: C.primary }]}
          >
            <Text style={styles.successBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable
          onPress={() => {
            if (step === 'select-offer') router.back();
            else if (step === 'select-receive') setStep('select-offer');
            else if (step === 'review') setStep('select-receive');
          }}
          style={styles.backBtn}
        >
          <Feather name={step === 'select-offer' ? 'x' : 'arrow-left'} size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Trade Offer</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Counterparty */}
      <View style={[styles.counterparty, { backgroundColor: C.card }]}>
        <View style={styles.cpAvatar}>
          <Text style={styles.cpAvatarText}>C</Text>
        </View>
        <View style={styles.cpInfo}>
          <Text style={styles.cpName}>cardvault_au</Text>
          <Text style={styles.cpMeta}>Verified Seller · Rating 4.8 (43 reviews)</Text>
        </View>
        <View style={[styles.cpBadge, { backgroundColor: `${C.positive}22` }]}>
          <Feather name="shield" size={12} color={C.positive} />
          <Text style={[styles.cpBadgeText, { color: C.positive }]}>Verified</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── SELECT YOUR CARD ────────────────────────────────── */}
        {step === 'select-offer' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>What will you offer?</Text>
            <Text style={styles.stepHint}>Select a card from your collection to offer in this trade.</Text>

            {/* Smart Trade demand insight */}
            <View style={[styles.smartTradeCard, { backgroundColor: `${C.primary}0D`, borderColor: `${C.primary}33` }]}>
              <View style={styles.smartTradeHeader}>
                <Feather name="zap" size={13} color={C.primary} />
                <Text style={[styles.smartTradeTitle, { color: C.primary }]}>Smart Trade — Demand Insight</Text>
              </View>
              <View style={styles.smartTradeStats}>
                <View style={styles.smartTradeStat}>
                  <Text style={styles.smartTradeValue}>{MOCK_SMART_SELL_STATS.tradeMatchCount}</Text>
                  <Text style={styles.smartTradeLabel}>collectors want this</Text>
                </View>
                <View style={styles.smartTradeStat}>
                  <Text style={styles.smartTradeValue}>{MOCK_SMART_SELL_STATS.ownWishlistCount}</Text>
                  <Text style={styles.smartTradeLabel}>own cards on your wishlist</Text>
                </View>
                <View style={styles.smartTradeStat}>
                  <Text style={styles.smartTradeValue}>{MOCK_SMART_SELL_STATS.atEventTradeCount}</Text>
                  <Text style={styles.smartTradeLabel}>at your current event</Text>
                </View>
              </View>
              <Pressable
                onPress={() => router.push('/trade-match' as any)}
                style={[styles.smartTradeCta, { backgroundColor: C.primary }]}
              >
                <Text style={styles.smartTradeCtaText}>Find Trade Matches</Text>
                <Feather name="arrow-right" size={13} color="#FFF" />
              </Pressable>
            </View>

            {collection.filter(i => i.isForTrade || true).map(item => (
              <Pressable
                key={item.id}
                onPress={() => setMyCardId(item.id)}
                style={[
                  styles.cardRow,
                  { backgroundColor: C.card },
                  myCardId === item.id && { borderColor: C.primary, borderWidth: 2 },
                ]}
              >
                <View style={[styles.cardThumb, { backgroundColor: item.card.gradientStart }]}>
                  <Text style={styles.cardInitial}>{item.card.name[0]}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{item.card.name}</Text>
                  <Text style={styles.cardMeta}>
                    {item.card.setName} ·{' '}
                    {item.grading ? `${item.grading.company} ${item.grading.grade}` : CONDITION_LABELS[item.condition]}
                  </Text>
                  <Text style={styles.cardValue}>
                    ${(item.grading?.grade === 10 ? item.card.price.psa10 ?? item.card.price.raw : item.card.price.raw).toLocaleString('en-AU')} est.
                  </Text>
                </View>
                {myCardId === item.id && <Feather name="check-circle" size={20} color={C.primary} />}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── SELECT THEIR CARD ───────────────────────────────── */}
        {step === 'select-receive' && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>What do you want?</Text>
            <Text style={styles.stepHint}>Select a card from their collection to request.</Text>
            {THEIR_CARDS.map(c => (
              <Pressable
                key={c.id}
                onPress={() => setTheirCardId(c.id)}
                style={[
                  styles.cardRow,
                  { backgroundColor: C.card },
                  theirCardId === c.id && { borderColor: C.primary, borderWidth: 2 },
                ]}
              >
                <View style={[styles.cardThumb, { backgroundColor: c.color }]}>
                  <Text style={styles.cardInitial}>{c.name[0]}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{c.name}</Text>
                  <Text style={styles.cardMeta}>{c.set} · {c.grade}</Text>
                  <Text style={styles.cardValue}>${c.value.toLocaleString('en-AU')} est.</Text>
                </View>
                {theirCardId === c.id && <Feather name="check-circle" size={20} color={C.primary} />}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── REVIEW ─────────────────────────────────────────── */}
        {step === 'review' && myItem && theirCard && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Review Trade Offer</Text>

            {/* Trade comparison */}
            <View style={styles.tradeCompare}>
              {/* You offer */}
              <View style={[styles.tradeSide, { backgroundColor: C.card }]}>
                <Text style={styles.tradeSideLabel}>YOU OFFER</Text>
                <View style={[styles.tradeThumb, { backgroundColor: myItem.card.gradientStart }]}>
                  <Text style={styles.tradeInitial}>{myItem.card.name[0]}</Text>
                </View>
                <Text style={styles.tradeName} numberOfLines={2}>{myItem.card.name}</Text>
                <Text style={styles.tradeGrade}>
                  {myItem.grading ? `${myItem.grading.company} ${myItem.grading.grade}` : CONDITION_LABELS[myItem.condition]}
                </Text>
                <Text style={styles.tradeValue}>${myValue.toLocaleString('en-AU')}</Text>
                <Text style={styles.tradeValueSub}>est. value</Text>
              </View>

              {/* Swap icon */}
              <View style={styles.swapIcon}>
                <Feather name="repeat" size={22} color={C.mutedForeground} />
              </View>

              {/* They offer */}
              <View style={[styles.tradeSide, { backgroundColor: C.card }]}>
                <Text style={styles.tradeSideLabel}>THEY OFFER</Text>
                <View style={[styles.tradeThumb, { backgroundColor: theirCard.color }]}>
                  <Text style={styles.tradeInitial}>{theirCard.name[0]}</Text>
                </View>
                <Text style={styles.tradeName} numberOfLines={2}>{theirCard.name}</Text>
                <Text style={styles.tradeGrade}>{theirCard.grade}</Text>
                <Text style={styles.tradeValue}>${theirValue.toLocaleString('en-AU')}</Text>
                <Text style={styles.tradeValueSub}>est. value</Text>
              </View>
            </View>

            {/* Value diff */}
            <View style={[styles.diffCard, { backgroundColor: C.card }]}>
              <Text style={styles.diffLabel}>Value Difference</Text>
              <Text style={[
                styles.diffValue,
                { color: Math.abs(diff) < 50 ? C.positive : diff > 0 ? C.warning : C.negative },
              ]}>
                {diff > 0 ? 'You give' : diff < 0 ? 'You receive'  : 'Even trade'}{' '}
                {diff !== 0 ? `$${Math.abs(diff).toLocaleString('en-AU')} more` : ''}
              </Text>
              {Math.abs(diff) < 50 && (
                <Text style={[styles.diffSub, { color: C.positive }]}>Fair trade</Text>
              )}
            </View>

            {/* Disclaimer */}
            <View style={[styles.disclaimer, { backgroundColor: `${C.warning}18`, borderColor: `${C.warning}44` }]}>
              <Feather name="info" size={14} color={C.warning} style={{ marginTop: 2 }} />
              <Text style={styles.disclaimerText}>
                Estimated values are based on recent market data and may not reflect actual sale prices. Both parties agree to trade at their own risk.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 16 }]}>
        {step === 'select-offer' && (
          <Pressable
            onPress={() => setStep('select-receive')}
            disabled={!myCardId}
            style={[styles.primaryBtn, { backgroundColor: myCardId ? C.primary : C.muted }]}
          >
            <Text style={[styles.primaryBtnText, { color: myCardId ? '#FFF' : C.mutedForeground }]}>
              Continue
            </Text>
            <Feather name="arrow-right" size={18} color={myCardId ? '#FFF' : C.mutedForeground} />
          </Pressable>
        )}
        {step === 'select-receive' && (
          <Pressable
            onPress={() => setStep('review')}
            disabled={!theirCardId}
            style={[styles.primaryBtn, { backgroundColor: theirCardId ? C.primary : C.muted }]}
          >
            <Text style={[styles.primaryBtnText, { color: theirCardId ? '#FFF' : C.mutedForeground }]}>
              Review Offer
            </Text>
            <Feather name="arrow-right" size={18} color={theirCardId ? '#FFF' : C.mutedForeground} />
          </Pressable>
        )}
        {step === 'review' && (
          <Pressable
            onPress={handleSendOffer}
            style={[styles.primaryBtn, { backgroundColor: C.primary }]}
          >
            <Feather name="send" size={18} color="#FFFFFF" />
            <Text style={[styles.primaryBtnText, { color: '#FFFFFF' }]}>Send Trade Offer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  counterparty: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  cpAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cpAvatarText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  cpInfo: { flex: 1 },
  cpName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  cpMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  cpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  cpBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  stepBody: { gap: 12 },
  stepTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  stepHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardThumb: { width: 50, height: 70, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  cardValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary, marginTop: 4 },
  tradeCompare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tradeSide: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  tradeSideLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    letterSpacing: 2,
  },
  tradeThumb: {
    width: 70,
    height: 98,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeInitial: { fontSize: 32, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  tradeName: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    textAlign: 'center',
  },
  tradeGrade: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  tradeValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  tradeValueSub: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  swapIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffCard: {
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  diffLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1 },
  diffValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  diffSub: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  disclaimer: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 19 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 16,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  successIcon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  successBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
  },
  successBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  successBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  // Smart Trade panel
  smartTradeCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  smartTradeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smartTradeTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  smartTradeStats: {
    flexDirection: 'row',
    gap: 8,
  },
  smartTradeStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  smartTradeValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  smartTradeLabel: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 13,
  },
  smartTradeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 10,
  },
  smartTradeCtaText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
});
