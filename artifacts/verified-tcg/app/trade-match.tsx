import React, { useState } from 'react';
import {
  Modal,
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
import colors from '@/constants/colors';
import { MOCK_TRADE_MATCHES } from '@/services/matching';
import type { TradeMatch, AlternativeCombination } from '@/services/matching';
import { useApp } from '@/context/AppContext';
import { canUseTradeMatchPlus } from '@/services/subscription';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';

const C = colors.dark;
const FREE_MATCH_LIMIT = 3;

export default function TradeMatchScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { watchlist, subscriptionTier } = useApp();
  const isPro = canUseTradeMatchPlus(subscriptionTier);

  // Show up to one match per wishlist item (min 1 so demo is never blank)
  const allMatches = MOCK_TRADE_MATCHES.slice(0, Math.max(1, watchlist.length));
  // Free users are capped at FREE_MATCH_LIMIT; Pro sees all
  const visibleMatches = isPro ? allMatches : allMatches.slice(0, FREE_MATCH_LIMIT);
  const hasMoreMatches = !isPro && allMatches.length > FREE_MATCH_LIMIT;

  const selectedMatch = allMatches.find(m => m.id === selectedId);

  if (selectedMatch) {
    return (
      <MatchDetail
        match={selectedMatch}
        isPro={isPro}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Trade Matches</Text>
        <View style={styles.headerRight}>
          <View style={[styles.countPill, { backgroundColor: `${C.primary}22` }]}>
            <Text style={[styles.countText, { color: C.primary }]}>{allMatches.length}</Text>
          </View>
          {/* Advanced Filters button */}
          <Pressable
            onPress={() => {
              if (isPro) {
                setFiltersOpen(true);
              } else {
                router.push('/pro-subscription' as any);
              }
            }}
            style={[styles.filterBtn, { backgroundColor: C.card }]}
            accessibilityLabel="Advanced Filters"
          >
            <Feather name="sliders" size={16} color={isPro ? C.foreground : C.mutedForeground} />
            {!isPro && (
              <View style={styles.lockBadgeSmall}>
                <Feather name="lock" size={8} color="#FFF" />
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* Subtitle */}
      <View style={styles.subtitleRow}>
        <Feather name="zap" size={14} color={C.primary} />
        <Text style={styles.subtitle}>
          {watchlist.length > 0
            ? `Based on your ${watchlist.length} wishlist ${watchlist.length === 1 ? 'card' : 'cards'} — collectors who have what you want`
            : 'Add cards to your wishlist to find collectors who have what you want'}
        </Text>
      </View>

      {watchlist.length === 0 && (
        <Pressable
          onPress={() => router.push('/wishlist' as any)}
          style={[styles.emptyWishlistBanner, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}
        >
          <Feather name="heart" size={16} color={C.primary} />
          <Text style={[styles.emptyWishlistText, { color: C.primary }]}>
            Build your wishlist to unlock trade matches
          </Text>
          <Feather name="chevron-right" size={16} color={C.primary} />
        </Pressable>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {visibleMatches.map((match, idx) =>
          isPro ? (
            <ProMatchCard
              key={match.id}
              match={match}
              rank={idx + 1}
              onPress={() => setSelectedId(match.id)}
            />
          ) : (
            <FreeMatchCard
              key={match.id}
              match={match}
              rank={idx + 1}
              onPress={() => setSelectedId(match.id)}
            />
          )
        )}

        {/* Pro gate card for Free users */}
        {hasMoreMatches && (
          <Pressable
            onPress={() => router.push('/pro-subscription' as any)}
            style={[styles.gateCard, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}
          >
            <View style={[styles.gateIconCircle, { backgroundColor: `${C.primary}18` }]}>
              <Feather name="zap" size={22} color={C.primary} />
            </View>
            <Text style={[styles.gateTitle, { color: C.foreground }]}>Unlock Trade Match+</Text>
            <Text style={[styles.gateDesc, { color: C.mutedForeground }]}>
              {allMatches.length - FREE_MATCH_LIMIT} more match{allMatches.length - FREE_MATCH_LIMIT !== 1 ? 'es' : ''} hidden · Smart suggestions, unlimited matches, match scores and cash balancing
            </Text>
            <View style={[styles.gateCtaRow, { backgroundColor: C.primary }]}>
              <Feather name="zap" size={14} color="#FFF" />
              <Text style={styles.gateCtaText}>Upgrade to Pro</Text>
            </View>
          </Pressable>
        )}

        <Text style={styles.disclaimer}>
          Trade matches are based on your wishlist and collection data. All values are estimates only.
        </Text>
      </ScrollView>

      {/* Advanced Filters sheet (Pro only) */}
      <AdvancedFiltersSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} />
    </View>
  );
}

// ─── Free match card ──────────────────────────────────────────────────────────

function FreeMatchCard({
  match,
  rank,
  onPress,
}: {
  match: TradeMatch;
  rank: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.matchCard, { backgroundColor: C.card }]}>
      <View style={styles.matchHeader}>
        <View style={[styles.matchPill, { backgroundColor: `${C.muted}` }]}>
          <Feather name="repeat" size={12} color={C.mutedForeground} />
          <Text style={[styles.matchPct, { color: C.mutedForeground }]}>Trade Match</Text>
        </View>
        <Text style={styles.matchRank}>#{rank}</Text>
      </View>

      <View style={styles.freeCardBody}>
        <View style={styles.freeCardRow}>
          <Feather name="check-circle" size={14} color={C.positive} />
          <Text style={[styles.freeCardLine, { color: C.foreground }]}>
            They have something you want
          </Text>
        </View>
        <View style={styles.freeCardRow}>
          <Feather name="check-circle" size={14} color={C.positive} />
          <Text style={[styles.freeCardLine, { color: C.foreground }]}>
            You have something they want
          </Text>
        </View>
      </View>

      {/* Collector info */}
      <View style={[styles.collectorRow, { borderTopColor: C.border }]}>
        <View style={[styles.avatar, { backgroundColor: match.collector.avatarColor }]}>
          <Text style={styles.avatarText}>{match.collector.initials}</Text>
        </View>
        <View style={styles.collectorInfo}>
          <View style={styles.collectorNameRow}>
            <Text style={styles.collectorName}>@{match.collector.username}</Text>
            {match.collector.isVerified && (
              <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                <Feather name="check-circle" size={10} color={C.positive} />
                <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
              </View>
            )}
          </View>
          <Text style={styles.collectorMeta}>{match.collector.location} · {match.collector.tradesCount} trades</Text>
        </View>
        <View style={styles.arrowWrap}>
          <Feather name="chevron-right" size={18} color={C.mutedForeground} />
        </View>
      </View>
    </Pressable>
  );
}

// ─── Pro match card ───────────────────────────────────────────────────────────

function ProMatchCard({
  match,
  rank,
  onPress,
}: {
  match: TradeMatch;
  rank: number;
  onPress: () => void;
}) {
  const cashAbs = Math.abs(match.suggestedCashBalance);
  const cashLabel =
    match.suggestedCashBalance === 0
      ? 'Estimated Balance: $0 (even trade)'
      : match.suggestedCashBalance > 0
      ? `You add ~$${cashAbs.toLocaleString('en-AU')} AUD`
      : `They add ~$${cashAbs.toLocaleString('en-AU')} AUD`;

  return (
    <Pressable onPress={onPress} style={[styles.matchCard, styles.proMatchCard, { backgroundColor: C.card }]}>
      {/* Match % badge — prominent for Pro */}
      <View style={styles.matchHeader}>
        <View style={[styles.proMatchBadge, { backgroundColor: matchColor(match.matchPercent) }]}>
          <Text style={styles.proMatchBadgeText}>{match.matchPercent}% MATCH</Text>
        </View>
        <Text style={styles.matchRank}>#{rank}</Text>
      </View>

      {/* Cards comparison — YOU OFFER / THEY OFFER */}
      <View style={styles.cardCompare}>
        <View style={styles.cardSide}>
          <Text style={styles.sideLabel}>YOU OFFER</Text>
          <View style={[styles.cardThumb, { backgroundColor: match.theyWant.color }]}>
            <Text style={styles.cardInitial}>{match.theyWant.name[0]}</Text>
          </View>
          <Text style={styles.cardName} numberOfLines={2}>{match.theyWant.name}</Text>
          <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
            <Text style={styles.gradePillText}>{match.theyWant.grade}</Text>
          </View>
          <Text style={styles.cardValue}>${match.theyWant.value.toLocaleString('en-AU')}</Text>
        </View>

        <View style={styles.swapCol}>
          <View style={[styles.swapCircle, { backgroundColor: C.muted }]}>
            <Feather name="repeat" size={16} color={C.mutedForeground} />
          </View>
        </View>

        <View style={styles.cardSide}>
          <Text style={styles.sideLabel}>THEY OFFER</Text>
          <View style={[styles.cardThumb, { backgroundColor: match.youWant.color }]}>
            <Text style={styles.cardInitial}>{match.youWant.name[0]}</Text>
          </View>
          <Text style={styles.cardName} numberOfLines={2}>{match.youWant.name}</Text>
          <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
            <Text style={styles.gradePillText}>{match.youWant.grade}</Text>
          </View>
          <Text style={styles.cardValue}>${match.youWant.value.toLocaleString('en-AU')}</Text>
        </View>
      </View>

      {/* Cash balance line */}
      <View style={[styles.cashBalanceRow, { backgroundColor: match.suggestedCashBalance === 0 ? `${C.positive}18` : `${C.warning}18` }]}>
        <Feather
          name="dollar-sign"
          size={12}
          color={match.suggestedCashBalance === 0 ? C.positive : C.warning}
        />
        <Text style={[styles.cashBalanceText, { color: match.suggestedCashBalance === 0 ? C.positive : C.warning }]}>
          {cashLabel}
        </Text>
      </View>

      {/* Collector info */}
      <View style={[styles.collectorRow, { borderTopColor: C.border }]}>
        <View style={[styles.avatar, { backgroundColor: match.collector.avatarColor }]}>
          <Text style={styles.avatarText}>{match.collector.initials}</Text>
        </View>
        <View style={styles.collectorInfo}>
          <View style={styles.collectorNameRow}>
            <Text style={styles.collectorName}>@{match.collector.username}</Text>
            {match.collector.isVerified && (
              <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                <Feather name="check-circle" size={10} color={C.positive} />
                <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
              </View>
            )}
          </View>
          <Text style={styles.collectorMeta}>{match.collector.location} · {match.collector.tradesCount} trades</Text>
        </View>
        {/* Build Trade CTA */}
        <Pressable style={[styles.buildTradeBtn, { backgroundColor: C.primary }]} onPress={onPress}>
          <Text style={styles.buildTradeBtnText}>Build Trade</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Match detail view ────────────────────────────────────────────────────────

function MatchDetail({
  match,
  isPro,
  onBack,
}: {
  match: TradeMatch;
  isPro: boolean;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
        <View style={[styles.sentIcon, { backgroundColor: `${C.positive}22` }]}>
          <Feather name="send" size={40} color={C.positive} />
        </View>
        <Text style={styles.sentTitle}>Offer Sent!</Text>
        <Text style={styles.sentBody}>
          Your trade offer has been sent to @{match.collector.username}.{'\n\n'}
          They have 48 hours to respond.{'\n\n'}
          (Prototype — no real offer sent.)
        </Text>
        <Pressable onPress={onBack} style={[styles.primaryBtn, { backgroundColor: C.primary, paddingHorizontal: 40 }]}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const diff = match.youWant.value - match.theyWant.value;

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>View Match</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { gap: 14 }]} showsVerticalScrollIndicator={false}>
        {/* Match score */}
        <View style={[styles.scoreCard, { backgroundColor: matchColor(match.matchPercent) + '18', borderColor: matchColor(match.matchPercent) + '44' }]}>
          <View style={[styles.scoreBadge, { backgroundColor: matchColor(match.matchPercent) }]}>
            <Text style={styles.scoreNum}>{match.matchPercent}%</Text>
          </View>
          <Text style={[styles.scoreLabel, { color: matchColor(match.matchPercent) }]}>Trade Match</Text>
          <Text style={styles.scoreDesc}>Mutual interest detected — you both have cards the other wants.</Text>
        </View>

        {/* Card comparison */}
        <View style={styles.detailCompare}>
          <View style={[styles.detailSide, { backgroundColor: C.card }]}>
            <Text style={styles.sideLabel}>YOU WANT</Text>
            <View style={[styles.detailThumb, { backgroundColor: match.youWant.color }]}>
              <Text style={styles.detailInitial}>{match.youWant.name[0]}</Text>
            </View>
            <Text style={styles.detailCardName} numberOfLines={2}>{match.youWant.name}</Text>
            <Text style={styles.detailSet}>{match.youWant.set}</Text>
            <View style={[styles.gradePill, { backgroundColor: C.muted, alignSelf: 'center' }]}>
              <Text style={styles.gradePillText}>{match.youWant.grade}</Text>
            </View>
            <Text style={styles.detailValue}>${match.youWant.value.toLocaleString('en-AU')}</Text>
            <Text style={styles.detailValueSub}>est. AUD</Text>
          </View>

          <View style={styles.detailSwap}>
            <Feather name="repeat" size={20} color={C.mutedForeground} />
          </View>

          <View style={[styles.detailSide, { backgroundColor: C.card }]}>
            <Text style={styles.sideLabel}>THEY WANT</Text>
            <View style={[styles.detailThumb, { backgroundColor: match.theyWant.color }]}>
              <Text style={styles.detailInitial}>{match.theyWant.name[0]}</Text>
            </View>
            <Text style={styles.detailCardName} numberOfLines={2}>{match.theyWant.name}</Text>
            <Text style={styles.detailSet}>{match.theyWant.set}</Text>
            <View style={[styles.gradePill, { backgroundColor: C.muted, alignSelf: 'center' }]}>
              <Text style={styles.gradePillText}>{match.theyWant.grade}</Text>
            </View>
            <Text style={styles.detailValue}>${match.theyWant.value.toLocaleString('en-AU')}</Text>
            <Text style={styles.detailValueSub}>est. AUD</Text>
          </View>
        </View>

        {/* Value difference */}
        <View style={[styles.diffCard, { backgroundColor: C.card }]}>
          <Text style={styles.diffCardLabel}>VALUE DIFFERENCE</Text>
          <Text style={[styles.diffCardValue, { color: Math.abs(diff) < 100 ? C.positive : C.warning }]}>
            {Math.abs(diff) < 100 ? 'Near-even trade' : `$${Math.abs(diff).toLocaleString('en-AU')} ${diff > 0 ? 'in your favour' : 'in their favour'}`}
          </Text>
          {Math.abs(diff) < 100 && (
            <Text style={[styles.diffCardSub, { color: C.positive }]}>Both parties benefit equally</Text>
          )}
        </View>

        {/* ── Pro-only: Smart suggestion ─────────────────────────────────── */}
        <ProFeaturePreview
          featureTitle="Smart Suggestion"
          description="AI-powered trade advice based on value, ratings, and market trends."
          ctaLabel="Unlock Trade Match+"
          previewContent={
            <View style={[styles.smartSuggestionCard, { backgroundColor: C.card }]}>
              <View style={styles.smartSuggestionHeader}>
                <Feather name="zap" size={14} color={C.primary} />
                <Text style={[styles.smartSuggestionTitle, { color: C.foreground }]}>Smart Suggestion</Text>
              </View>
              <Text style={[styles.smartSuggestionText, { color: C.mutedForeground }]}>
                {match.smartSuggestion}
              </Text>
            </View>
          }
          lockedContent={
            <View style={[styles.smartSuggestionCard, { backgroundColor: C.card }]}>
              <View style={styles.smartSuggestionHeader}>
                <Feather name="zap" size={14} color={C.primary} />
                <Text style={[styles.smartSuggestionTitle, { color: C.foreground }]}>Smart Suggestion</Text>
              </View>
              <Text style={[styles.smartSuggestionText, { color: C.mutedForeground }]}>
                {match.smartSuggestion}
              </Text>
            </View>
          }
        />

        {/* ── Pro-only: Other possible combinations ─────────────────────── */}
        <ProFeaturePreview
          featureTitle="Other Combinations"
          description="See alternative card combinations that could make this trade work."
          ctaLabel="Unlock Trade Match+"
          previewContent={
            <AlternativeCombinationsCard combinations={match.alternativeCombinations} />
          }
          lockedContent={
            <AlternativeCombinationsCard combinations={match.alternativeCombinations} />
          }
        />

        {/* Collector card */}
        <View style={[styles.collectorDetailCard, { backgroundColor: C.card }]}>
          <Text style={styles.sideLabel}>COLLECTOR</Text>
          <View style={styles.collectorDetailRow}>
            <View style={[styles.avatarLg, { backgroundColor: match.collector.avatarColor }]}>
              <Text style={styles.avatarLgText}>{match.collector.initials}</Text>
            </View>
            <View style={styles.collectorDetailInfo}>
              <View style={styles.collectorNameRow}>
                <Text style={styles.collectorDetailName}>@{match.collector.username}</Text>
                {match.collector.isVerified && (
                  <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                    <Feather name="check-circle" size={10} color={C.positive} />
                    <Text style={[styles.verText, { color: C.positive }]}>Verified Collector</Text>
                  </View>
                )}
              </View>
              <Text style={styles.collectorMeta}>{match.collector.location}</Text>
              <View style={styles.ratingRow}>
                <Feather name="star" size={12} color={C.warning} />
                <Text style={styles.ratingText}>{match.collector.rating.toFixed(1)} · {match.collector.tradesCount} completed trades</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer actions */}
      <View style={[styles.detailFooter, { paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 16 }]}>
        <Pressable
          onPress={() => router.push('/trade-value-assistant' as any)}
          style={[styles.secondaryBtn, { backgroundColor: C.card, flex: 1 }]}
        >
          <Feather name="sliders" size={16} color={C.foreground} />
          <Text style={[styles.secondaryBtnText, { color: C.foreground }]}>Value Assistant</Text>
        </Pressable>
        <Pressable
          onPress={() => setSent(true)}
          style={[styles.primaryBtn, { flex: 2 }]}
        >
          <Feather name="send" size={16} color="#FFF" />
          <Text style={styles.primaryBtnText}>Send Trade Offer</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Alternative combinations card ───────────────────────────────────────────

function AlternativeCombinationsCard({ combinations }: { combinations: AlternativeCombination[] }) {
  return (
    <View style={[styles.altCombCard, { backgroundColor: C.card }]}>
      <Text style={styles.sideLabel}>OTHER POSSIBLE COMBINATIONS</Text>
      {combinations.map((combo, idx) => (
        <View key={idx} style={[styles.altCombItem, idx < combinations.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
          <View style={styles.altCombLabelRow}>
            <View style={[styles.altCombLabelPill, { backgroundColor: `${C.primary}22` }]}>
              <Text style={[styles.altCombLabel, { color: C.primary }]}>{combo.label}</Text>
            </View>
            <Text style={[styles.altCombDesc, { color: C.mutedForeground }]} numberOfLines={2}>
              {combo.description}
            </Text>
          </View>
          <View style={styles.altCombColumns}>
            <View style={styles.altCombSide}>
              <Text style={[styles.altCombSideLabel, { color: C.mutedForeground }]}>YOU OFFER</Text>
              {combo.yourCards.map((card, ci) => (
                <View key={ci} style={styles.altCombCardRow}>
                  <View style={[styles.altCombDot, { backgroundColor: card.color }]} />
                  <Text style={[styles.altCombCardName, { color: C.foreground }]} numberOfLines={1}>{card.name}</Text>
                </View>
              ))}
            </View>
            <Feather name="repeat" size={14} color={C.mutedForeground} style={{ marginTop: 18 }} />
            <View style={styles.altCombSide}>
              <Text style={[styles.altCombSideLabel, { color: C.mutedForeground }]}>THEY OFFER</Text>
              {combo.theirCards.map((card, ci) => (
                <View key={ci} style={styles.altCombCardRow}>
                  <View style={[styles.altCombDot, { backgroundColor: card.color }]} />
                  <Text style={[styles.altCombCardName, { color: C.foreground }]} numberOfLines={1}>{card.name}</Text>
                </View>
              ))}
            </View>
          </View>
          {combo.estimatedBalance !== 0 && (
            <Text style={[styles.altCombBalance, { color: C.warning }]}>
              {combo.estimatedBalance > 0
                ? `+ $${combo.estimatedBalance} AUD you receive`
                : `+ $${Math.abs(combo.estimatedBalance)} AUD you pay`}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Advanced Filters sheet (Pro) ─────────────────────────────────────────────

function AdvancedFiltersSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [distanceFilter, setDistanceFilter] = useState<string | null>(null);
  const [valueMin, setValueMin] = useState<string | null>(null);

  const grades = ['PSA 10', 'PSA 9+', 'BGS 9.5+', 'CGC 10', 'Any'];
  const distances = ['At this event', 'Same city', 'Same state', 'Australia-wide'];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <View style={styles.sheetHandle} />
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sheetTitle, { color: C.foreground }]}>Advanced Filters</Text>
          <Text style={[styles.sheetSubtitle, { color: C.mutedForeground }]}>
            Narrow your Trade Match+ results
          </Text>

          {/* Grade filter */}
          <Text style={[styles.filterLabel, { color: C.mutedForeground }]}>MINIMUM GRADE</Text>
          <View style={styles.filterChips}>
            {grades.map(g => (
              <Pressable
                key={g}
                onPress={() => setGradeFilter(gradeFilter === g ? null : g)}
                style={[
                  styles.filterChip,
                  { backgroundColor: gradeFilter === g ? C.primary : C.muted },
                ]}
              >
                <Text style={[styles.filterChipText, { color: gradeFilter === g ? '#FFF' : C.mutedForeground }]}>{g}</Text>
              </Pressable>
            ))}
          </View>

          {/* Distance filter */}
          <Text style={[styles.filterLabel, { color: C.mutedForeground }]}>DISTANCE</Text>
          <View style={styles.filterChips}>
            {distances.map(d => (
              <Pressable
                key={d}
                onPress={() => setDistanceFilter(distanceFilter === d ? null : d)}
                style={[
                  styles.filterChip,
                  { backgroundColor: distanceFilter === d ? C.primary : C.muted },
                ]}
              >
                <Text style={[styles.filterChipText, { color: distanceFilter === d ? '#FFF' : C.mutedForeground }]}>{d}</Text>
              </Pressable>
            ))}
          </View>

          {/* Value range */}
          <Text style={[styles.filterLabel, { color: C.mutedForeground }]}>MIN CARD VALUE (AUD)</Text>
          <View style={styles.filterChips}>
            {['$0', '$100', '$500', '$1,000'].map(v => (
              <Pressable
                key={v}
                onPress={() => setValueMin(valueMin === v ? null : v)}
                style={[
                  styles.filterChip,
                  { backgroundColor: valueMin === v ? C.primary : C.muted },
                ]}
              >
                <Text style={[styles.filterChipText, { color: valueMin === v ? '#FFF' : C.mutedForeground }]}>{v}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onClose}
            style={[styles.applyBtn, { backgroundColor: C.primary }]}
          >
            <Text style={[styles.applyBtnText, { color: '#FFF' }]}>Apply Filters</Text>
          </Pressable>

          <Pressable onPress={onClose} style={styles.dismissLink}>
            <Text style={[styles.dismissText, { color: C.mutedForeground }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchColor(pct: number) {
  if (pct >= 90) return '#22C55E';
  if (pct >= 75) return '#F59E0B';
  return '#888888';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  filterBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  lockBadgeSmall: {
    position: 'absolute',
    bottom: 6, right: 6,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, marginBottom: 14 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, flex: 1, lineHeight: 18 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },

  // Match cards shared
  matchCard: { borderRadius: 18, padding: 16, marginBottom: 14 },
  proMatchCard: { borderWidth: 1, borderColor: `${C.primary}22` },
  matchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  matchPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  matchDot: { width: 6, height: 6, borderRadius: 3 },
  matchPct: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  matchRank: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Pro match badge
  proMatchBadge: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
  },
  proMatchBadgeText: {
    fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 0.5,
  },

  // Free card body
  freeCardBody: { gap: 8, marginBottom: 14 },
  freeCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freeCardLine: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  // Card comparison
  cardCompare: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  cardSide: { flex: 1, alignItems: 'center', gap: 6 },
  sideLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  cardThumb: { width: 64, height: 90, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 28, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  gradePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  cardValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  swapCol: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 20 },
  swapCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  // Cash balance row
  cashBalanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 12,
  },
  cashBalanceText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // Build Trade button (inside match card)
  buildTradeBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  buildTradeBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Collector row
  collectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, borderTopWidth: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorInfo: { flex: 1 },
  collectorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  collectorName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  verBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  collectorMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  arrowWrap: {},

  // Pro gate card
  gateCard: {
    borderRadius: 18, padding: 20, marginBottom: 14,
    borderWidth: 1.5, borderStyle: 'dashed',
    alignItems: 'center', gap: 10,
  },
  gateIconCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  gateTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  gateDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
  gateCtaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12,
    marginTop: 4,
  },
  gateCtaText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}77`, textAlign: 'center', lineHeight: 18, marginTop: 8 },
  emptyWishlistBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 8,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  emptyWishlistText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },

  // Detail view
  scoreCard: { borderRadius: 16, padding: 20, borderWidth: 1, alignItems: 'center', gap: 8 },
  scoreBadge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  scoreNum: { fontSize: 32, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  scoreLabel: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  scoreDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 18 },
  detailCompare: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  detailSide: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6 },
  detailThumb: { width: 72, height: 100, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  detailInitial: { fontSize: 32, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  detailCardName: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  detailSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  detailValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  detailValueSub: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  detailSwap: { alignItems: 'center', justifyContent: 'center', width: 32 },
  diffCard: { borderRadius: 16, padding: 18, alignItems: 'center', gap: 6 },
  diffCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1.5 },
  diffCardValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  diffCardSub: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  // Smart suggestion card
  smartSuggestionCard: { borderRadius: 16, padding: 16, gap: 10 },
  smartSuggestionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smartSuggestionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  smartSuggestionText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },

  // Alternative combinations card
  altCombCard: { borderRadius: 16, padding: 16, gap: 12 },
  altCombItem: { paddingVertical: 12, gap: 10 },
  altCombLabelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  altCombLabelPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  altCombLabel: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  altCombDesc: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  altCombColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  altCombSide: { flex: 1, gap: 6 },
  altCombSideLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  altCombCardRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  altCombDot: { width: 8, height: 8, borderRadius: 4 },
  altCombCardName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', flex: 1 },
  altCombBalance: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  // Collector detail card
  collectorDetailCard: { borderRadius: 16, padding: 16, gap: 12 },
  collectorDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarLg: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarLgText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorDetailInfo: { flex: 1, gap: 4 },
  collectorDetailName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Footer
  detailFooter: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.background,
  },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: C.primary },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14 },
  secondaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  sentIcon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  sentTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  sentBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 22 },

  // Advanced Filters sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  sheetTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', marginBottom: 4 },
  sheetSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20, lineHeight: 18 },
  filterLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 10 },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  filterChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  applyBtn: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  dismissLink: { alignItems: 'center', paddingVertical: 8 },
  dismissText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
