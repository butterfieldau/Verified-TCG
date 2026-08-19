import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useApp } from '@/context/AppContext';
import {
  fetchActiveEvents,
  joinEvent,
  leaveEvent,
  fetchMyParticipation,
  fetchTradeMatches,
  type EventSummary,
  type TradeMatchResult,
} from '@/services/eventsApi';

const C = colors.dark;

type EventTab = 'matches' | 'wishlist' | 'want_yours' | 'for_sale' | 'trending';

const TABS: { label: string; value: EventTab }[] = [
  { label: 'Matches',   value: 'matches'    },
  { label: 'Wishlist',  value: 'wishlist'   },
  { label: 'Want Yours',value: 'want_yours' },
  { label: 'For Sale',  value: 'for_sale'   },
  { label: 'Trending',  value: 'trending'   },
];

const FREE_MATCH_LIMIT = 3;

function isLiveEvent(ev: EventSummary | null): boolean {
  return ev?.status === 'live';
}

export default function EventModeScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { watchlist, subscriptionTier, isAuthenticated, setCurrentEventId } = useApp();
  const isPro = subscriptionTier === 'pro';

  // ── State ─────────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [isInEvent, setIsInEvent] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const [activeTab, setActiveTab] = useState<EventTab>('matches');
  const [tradeMatches, setTradeMatches] = useState<TradeMatchResult[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesError, setMatchesError] = useState(false);

  const wishlistCount = watchlist.length;

  // ── Load active events ────────────────────────────────────────────────────
  const loadEvents = useCallback(() => {
    setEventsLoading(true);
    setEventsError(false);
    fetchActiveEvents()
      .then(list => {
        setEvents(list);
        setSelectedEvent(list.length > 0 ? list[0] : null);
      })
      .catch(() => {
        // No fabricated fallback — surface an explicit, retryable error state.
        setEvents([]);
        setSelectedEvent(null);
        setEventsError(true);
      })
      .finally(() => setEventsLoading(false));
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Check existing participation when event selected ──────────────────────
  useEffect(() => {
    if (!selectedEvent || !isAuthenticated) return;
    fetchMyParticipation(selectedEvent.id)
      .then(({ isParticipating }) => {
        if (isParticipating) setIsInEvent(true);
      })
      .catch(() => {});
  }, [selectedEvent, isAuthenticated]);

  // ── Load trade matches when entering event ────────────────────────────────
  const loadTradeMatches = useCallback(async (eventId: string) => {
    if (!isAuthenticated) return;
    setMatchesLoading(true);
    setMatchesError(false);
    try {
      const result = await fetchTradeMatches(eventId);
      setMatchCount(result.matchCount);
      setTradeMatches(result.matches);
    } catch {
      // API error — surface an unavailable state rather than an unauthentic zero.
      setMatchesError(true);
      setTradeMatches([]);
      setMatchCount(0);
    } finally {
      setMatchesLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isInEvent && selectedEvent) {
      loadTradeMatches(selectedEvent.id);
    }
  }, [isInEvent, selectedEvent, loadTradeMatches]);

  // ── Join / Leave handlers ─────────────────────────────────────────────────
  const handleEnterEvent = useCallback(async () => {
    if (!selectedEvent) return;
    if (!isAuthenticated) {
      Alert.alert('Sign In Required', 'Please sign in to join an event.');
      return;
    }
    setIsJoining(true);
    try {
      await joinEvent(selectedEvent.id);
      setIsInEvent(true);
      if (setCurrentEventId) setCurrentEventId(selectedEvent.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to join event';
      Alert.alert('Join Failed', msg);
    } finally {
      setIsJoining(false);
    }
  }, [selectedEvent, isAuthenticated, setCurrentEventId]);

  const handleLeaveEvent = useCallback(async () => {
    if (!selectedEvent) return;
    setIsLeaving(true);
    try {
      await leaveEvent(selectedEvent.id);
      setIsInEvent(false);
      setTradeMatches([]);
      setMatchCount(0);
      setMatchesError(false);
      if (setCurrentEventId) setCurrentEventId(null);
    } catch (e: unknown) {
      // Leave failed on the server — keep the collector in the event so local
      // state stays truthful, and let them retry.
      const msg = e instanceof Error ? e.message : 'Failed to leave event';
      Alert.alert('Leave Failed', msg);
    } finally {
      setIsLeaving(false);
    }
  }, [selectedEvent, setCurrentEventId]);

  const participantCount = selectedEvent?.participantCount ?? 0;
  const screenTitle = isPro ? 'Event Mode+' : 'Event Mode';

  const visibleMatches = isPro ? tradeMatches : tradeMatches.slice(0, FREE_MATCH_LIMIT);
  const showProTeaser = !isPro;

  // ── Entry Screen ─────────────────────────────────────────────────────────────
  if (!isInEvent) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background }]}>
        {/* Nav */}
        <View style={[styles.nav, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => router.back()} style={styles.navBack}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <View style={styles.navTitleRow}>
            <Text style={styles.navTitle}>{screenTitle}</Text>
            {isPro && (
              <View style={styles.proChip}>
                <Feather name="zap" size={10} color={C.primaryForeground} />
                <Text style={styles.proChipText}>PRO</Text>
              </View>
            )}
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.enterScroll, { paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {eventsLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={C.primary} />
              <Text style={styles.loadingText}>Finding nearby events…</Text>
            </View>
          ) : eventsError ? (
            <View style={[styles.heroCard, { backgroundColor: C.card }]}>
              <Feather name="wifi-off" size={32} color={C.mutedForeground} />
              <Text style={[styles.heroName, { marginTop: 12 }]}>Events Unavailable</Text>
              <Text style={styles.heroVenue}>
                We couldn't load events right now. Please check your connection and try again.
              </Text>
              <Pressable
                onPress={loadEvents}
                style={[styles.emptyStateCta, { backgroundColor: C.primary }]}
              >
                <Text style={styles.emptyStateCtaText}>Try Again</Text>
              </Pressable>
            </View>
          ) : selectedEvent ? (
            <>
              {/* Hero card */}
              <View style={[styles.heroCard, { backgroundColor: C.card }]}>
                <View style={styles.heroBadgeRow}>
                  <View style={[styles.heroBadge, { backgroundColor: `${C.primary}22` }]}>
                    {isLiveEvent(selectedEvent) && <View style={styles.livePulse} />}
                    <Text style={[styles.heroBadgeText, { color: C.primary }]}>
                      {isLiveEvent(selectedEvent) ? 'LIVE' : 'UPCOMING'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.heroName}>{selectedEvent.name}</Text>
                <Text style={styles.heroVenue}>{selectedEvent.venue}</Text>
                <Text style={styles.heroCity}>{selectedEvent.city} · {selectedEvent.eventDate}</Text>
                <View style={[styles.heroDivider, { backgroundColor: C.border }]} />
                <View style={styles.heroMeta}>
                  <Feather name="users" size={13} color={C.mutedForeground} />
                  <Text style={styles.heroMetaText}>{participantCount} collectors registered</Text>
                </View>
              </View>

              {/* Event selector — show if multiple events available */}
              {events.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.eventPickerScroll}>
                  {events.map(ev => (
                    <Pressable
                      key={ev.id}
                      onPress={() => setSelectedEvent(ev)}
                      style={[
                        styles.eventChip,
                        { backgroundColor: C.card, borderColor: selectedEvent?.id === ev.id ? C.primary : 'transparent' },
                      ]}
                    >
                      <Text style={[styles.eventChipText, { color: selectedEvent?.id === ev.id ? C.primary : C.foreground }]}>
                        {ev.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              {/* Wishlist nudge — helps collectors get relevant matches once inside */}
              {wishlistCount === 0 && (
                <Pressable
                  onPress={() => router.push('/wishlist' as any)}
                  style={[styles.nudge, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}
                >
                  <Feather name="heart" size={14} color={C.primary} />
                  <Text style={[styles.nudgeText, { color: C.primary }]}>
                    Add cards to your wishlist to find trade matches at this event
                  </Text>
                  <Feather name="chevron-right" size={14} color={C.primary} />
                </Pressable>
              )}

              {/* Feature list */}
              <View style={[styles.featureCard, { backgroundColor: C.card }]}>
                <Text style={styles.featureHeading}>Event Mode unlocks</Text>
                {([
                  { icon: 'repeat', text: 'Find trade matches from collectors participating in this event' },
                  { icon: 'heart', text: 'Use your wishlist and For Trade cards to find relevant matches' },
                ] as const).map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <View style={[styles.featureIconWrap, { backgroundColor: `${C.primary}18` }]}>
                      <Feather name={f.icon} size={14} color={C.primary} />
                    </View>
                    <Text style={styles.featureText}>{f.text}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <View style={[styles.heroCard, { backgroundColor: C.card }]}>
              <Feather name="calendar" size={32} color={C.mutedForeground} />
              <Text style={[styles.heroName, { marginTop: 12 }]}>No Active Events</Text>
              <Text style={styles.heroVenue}>Check back soon for upcoming TCG events near you.</Text>
            </View>
          )}

          {/* CTA */}
          {selectedEvent && (
            <Pressable
              onPress={handleEnterEvent}
              disabled={isJoining || eventsLoading}
              style={({ pressed }) => [styles.cta, { opacity: pressed || isJoining ? 0.85 : 1 }]}
            >
              {isJoining ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Feather name="zap" size={18} color="#FFF" />
              )}
              <Text style={styles.ctaText}>
                {isJoining ? 'Joining…' : 'Enter Event Mode'}
              </Text>
            </Pressable>
          )}

          <Text style={styles.disclaimer}>
            Event Mode uses your wishlist and collection data to surface relevant matches. No GPS is used.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Active Dashboard ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>

      {/* ── Header ── */}
      <View style={[styles.dashHeader, { paddingTop: topPad + 10 }]}>
        <View style={styles.dashHeaderLeft}>
          <View style={styles.liveRow}>
            {isLiveEvent(selectedEvent) && <View style={styles.liveDot} />}
            <Text style={styles.liveLabel}>{isLiveEvent(selectedEvent) ? 'LIVE' : 'UPCOMING'}</Text>
          </View>
          <View style={styles.dashTitleRow}>
            <Text style={styles.dashEventName} numberOfLines={1}>{screenTitle}</Text>
            {isPro && (
              <View style={styles.proChip}>
                <Feather name="zap" size={10} color={C.primaryForeground} />
                <Text style={styles.proChipText}>PRO</Text>
              </View>
            )}
          </View>
          <Text style={styles.dashEventSub}>{selectedEvent?.venue ?? ''}{selectedEvent?.venue && selectedEvent?.eventDate ? ' · ' : ''}{selectedEvent?.eventDate ?? ''}</Text>
        </View>
        <Pressable
          onPress={handleLeaveEvent}
          disabled={isLeaving}
          style={[styles.leaveBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}30` }]}
        >
          {isLeaving ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Feather name="log-out" size={13} color={C.primary} />
          )}
          <Text style={[styles.leaveBtnText, { color: C.primary }]}>Leave</Text>
        </Pressable>
      </View>

      {/* ── Category pills (navigation only) ──
          Only Trade Matches has a real API-backed count; the other categories
          are not yet backed by a data source, so no synthetic number is shown. */}
      <View style={styles.statGrid}>
        {([
          { emoji: '🤝', value: matchesError ? null : matchCount, label: 'trade matches',   tab: 'matches'    },
        ] as const).map(s => (
          <Pressable
            key={s.emoji}
            onPress={() => setActiveTab(s.tab as EventTab)}
            style={[
              styles.statPill,
              { backgroundColor: C.card, borderColor: 'transparent', borderWidth: 1 },
              activeTab === s.tab && { borderColor: C.primary },
            ]}
          >
            <Text style={styles.statPillEmoji}>{s.emoji}</Text>
            {s.value !== null && <Text style={styles.statPillValue}>{s.value}</Text>}
            <Text style={styles.statPillLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Section tabs ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { borderBottomColor: C.border }]}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map(t => (
          <Pressable
            key={t.value}
            onPress={() => setActiveTab(t.value)}
            style={[styles.tabItem, activeTab === t.value && { borderBottomColor: C.primary }]}
          >
            <Text style={[styles.tabItemText, activeTab === t.value && { color: C.foreground }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Tab content ── */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={[styles.tabContentInner, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* MATCHES */}
        {activeTab === 'matches' && (
          <View style={styles.cardList}>
            {matchesLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={C.primary} />
                <Text style={styles.loadingText}>Finding trade matches…</Text>
              </View>
            ) : matchesError ? (
              <View style={[styles.emptyState, { backgroundColor: C.card }]}>
                <Feather name="wifi-off" size={28} color={C.mutedForeground} />
                <Text style={styles.emptyStateTitle}>Trade Matches Unavailable</Text>
                <Text style={styles.emptyStateBody}>
                  We couldn't load your trade matches right now. Please try again in a moment.
                </Text>
                {selectedEvent && (
                  <Pressable
                    onPress={() => loadTradeMatches(selectedEvent.id)}
                    style={[styles.emptyStateCta, { backgroundColor: C.primary }]}
                  >
                    <Text style={styles.emptyStateCtaText}>Try Again</Text>
                  </Pressable>
                )}
              </View>
            ) : visibleMatches.length > 0 ? (
              visibleMatches.map(match => (
                <Pressable
                  key={match.participantUserId}
                  onPress={() =>
                    router.push({
                      pathname: '/event/event-profile' as any,
                      params: {
                        userId: match.participantUserId,
                        displayName: match.displayName,
                        username: match.username,
                        matchScore: String(match.matchScore),
                        theyHave: JSON.stringify(match.theyHave),
                        youHave: JSON.stringify(match.youHave),
                      },
                    })
                  }
                  style={[styles.matchCard, { backgroundColor: C.card }]}
                >
                  <View style={styles.matchHeader}>
                    <View style={[styles.matchBadge, { backgroundColor: '#22C55E18' }]}>
                      <View style={[styles.matchDot, { backgroundColor: '#22C55E' }]} />
                      {isPro ? (
                        <Text style={[styles.matchBadgeText, { color: '#22C55E' }]}>{match.matchScore}% Match</Text>
                      ) : (
                        <Text style={[styles.matchBadgeText, { color: '#22C55E' }]}>Trade Match</Text>
                      )}
                    </View>
                    <Text style={styles.atEventTag}>AT THIS EVENT</Text>
                  </View>

                  <View style={styles.matchTrades}>
                    {match.theyHave[0] && (
                      <View style={styles.matchSide}>
                        <View style={[styles.matchThumb, { backgroundColor: '#3B82F6' }]} />
                        <View style={styles.matchSideInfo}>
                          <Text style={styles.matchSideLabel}>YOU WANT</Text>
                          <Text style={styles.matchSideName} numberOfLines={1}>{match.theyHave[0].name}</Text>
                          <Text style={styles.matchSideMeta}>{match.theyHave[0].grade}</Text>
                        </View>
                      </View>
                    )}
                    <View style={[styles.matchSwapIcon, { backgroundColor: C.background }]}>
                      <Feather name="repeat" size={12} color={C.mutedForeground} />
                    </View>
                    {match.youHave[0] && (
                      <View style={[styles.matchSide, styles.matchSideRight]}>
                        <View style={styles.matchSideInfo}>
                          <Text style={[styles.matchSideLabel, { textAlign: 'right' }]}>THEY WANT</Text>
                          <Text style={[styles.matchSideName, { textAlign: 'right' }]} numberOfLines={1}>{match.youHave[0].name}</Text>
                          <Text style={[styles.matchSideMeta, { textAlign: 'right' }]}>{match.youHave[0].grade}</Text>
                        </View>
                        <View style={[styles.matchThumb, { backgroundColor: '#22C55E' }]} />
                      </View>
                    )}
                  </View>

                  <View style={[styles.matchFooter, { borderTopColor: C.border }]}>
                    <View style={[styles.matchAvatar, { backgroundColor: C.primary }]}>
                      <Text style={styles.matchAvatarText}>{match.displayName.substring(0, 2).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.matchUsername}>@{match.username}</Text>
                    <View style={{ flex: 1 }} />
                    <Feather name="chevron-right" size={14} color={C.mutedForeground} />
                  </View>
                </Pressable>
              ))
            ) : (
              <View style={[styles.emptyState, { backgroundColor: C.card }]}>
                <Feather name="repeat" size={28} color={C.mutedForeground} />
                <Text style={styles.emptyStateTitle}>No Trade Matches Yet</Text>
                <Text style={styles.emptyStateBody}>
                  {wishlistCount === 0
                    ? 'Add cards to your wishlist and mark collection cards as For Trade to find matches.'
                    : 'No other participants have matching cards yet. Check back as more collectors join.'}
                </Text>
                {wishlistCount === 0 && (
                  <Pressable
                    onPress={() => router.push('/wishlist' as any)}
                    style={[styles.emptyStateCta, { backgroundColor: C.primary }]}
                  >
                    <Text style={styles.emptyStateCtaText}>Build Wishlist</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Pro teaser — shown for Free users when the API reports more matches
                than the free limit. The only number displayed is the real,
                API-backed count of hidden matches. */}
            {showProTeaser && !matchesError && matchCount > FREE_MATCH_LIMIT && (
              <View style={[styles.proTeaserCard, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}>
                <View style={styles.proTeaserHeader}>
                  <View style={[styles.proTeaserBadge, { backgroundColor: C.primary }]}>
                    <Feather name="zap" size={11} color={C.primaryForeground} />
                    <Text style={styles.proTeaserBadgeText}>Event Mode+</Text>
                  </View>
                </View>

                <View style={styles.proTeaserStats}>
                  <View style={styles.proTeaserStatRow}>
                    <Text style={styles.proTeaserStatEmoji}>🤝</Text>
                    <Text style={styles.proTeaserStatText}>
                      <Text style={styles.proTeaserStatHighlight}>+{matchCount - FREE_MATCH_LIMIT} more Trade Matches</Text>
                      {' '}with Pro
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => router.push('/pro-subscription' as any)}
                  style={({ pressed }) => [styles.proTeaserCta, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={styles.proTeaserCtaText}>See All Matches → Unlock Event Mode+</Text>
                </Pressable>
              </View>
            )}

            {/* Benefits-only teaser when there are no hidden matches to quantify.
                Describes what Pro unlocks without inventing any counts. */}
            {showProTeaser && !matchesError && matchCount <= FREE_MATCH_LIMIT && (
              <View style={[styles.proTeaserCard, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}>
                <View style={styles.proTeaserHeader}>
                  <View style={[styles.proTeaserBadge, { backgroundColor: C.primary }]}>
                    <Feather name="zap" size={11} color={C.primaryForeground} />
                    <Text style={styles.proTeaserBadgeText}>Event Mode+</Text>
                  </View>
                </View>

                <View style={styles.proTeaserStats}>
                  <View style={styles.proTeaserStatRow}>
                    <Text style={styles.proTeaserStatEmoji}>🤝</Text>
                    <Text style={styles.proTeaserStatText}>
                      See every event trade match plus API-backed match percentages with Pro.
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => router.push('/pro-subscription' as any)}
                  style={({ pressed }) => [styles.proTeaserCta, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={styles.proTeaserCtaText}>Unlock Event Mode+</Text>
                </Pressable>
              </View>
            )}

          </View>
        )}

        {/* WISHLIST NEARBY — no data source yet */}
        {activeTab === 'wishlist' && (
          <View style={[styles.emptyState, { backgroundColor: C.card }]}>
            <Feather name="heart" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyStateTitle}>Wishlist Nearby</Text>
            <Text style={styles.emptyStateBody}>
              We'll show which collectors and vendors at this event have your wishlisted cards once
              on-site inventory is available.
            </Text>
          </View>
        )}

        {/* WANT YOUR CARDS — no data source yet */}
        {activeTab === 'want_yours' && (
          <View style={[styles.emptyState, { backgroundColor: C.card }]}>
            <Feather name="eye" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyStateTitle}>People Want Your Cards</Text>
            <Text style={styles.emptyStateBody}>
              We'll show which collectors at this event are looking for cards you own once event
              want-lists are available.
            </Text>
          </View>
        )}

        {/* FOR SALE — no data source yet */}
        {activeTab === 'for_sale' && (
          <View style={[styles.emptyState, { backgroundColor: C.card }]}>
            <Feather name="tag" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyStateTitle}>For Sale at This Event</Text>
            <Text style={styles.emptyStateBody}>
              Listings from vendors and collectors at this event aren't available yet. Check back
              soon.
            </Text>
          </View>
        )}

        {/* TRENDING — no data source yet */}
        {activeTab === 'trending' && (
          <View style={[styles.emptyState, { backgroundColor: C.card }]}>
            <Feather name="trending-up" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyStateTitle}>Trending at This Event</Text>
            <Text style={styles.emptyStateBody}>
              Trending cards for this event aren't available yet. Check back soon.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // ── Entry screen ──────────────────────────────────────────────────────────────
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  navBack: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
  },
  navTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },

  enterScroll: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },

  heroCard: { borderRadius: 20, padding: 20, alignItems: 'center', gap: 8 },
  heroBadgeRow: { alignItems: 'center' },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  livePulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary },
  heroBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  heroName: { fontSize: 24, fontFamily: 'Rajdhani_700Bold', color: C.foreground, textAlign: 'center', letterSpacing: -0.3 },
  heroVenue: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  heroCity: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  heroDivider: { width: '100%', height: 1, marginVertical: 4 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetaText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  eventPickerScroll: { flexGrow: 0 },
  eventChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8,
    borderWidth: 1.5,
  },
  eventChipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 0.8, textTransform: 'uppercase' },

  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  nudgeText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    flex: 1, minWidth: '45%', borderRadius: 14, padding: 14,
    alignItems: 'center', gap: 6,
  },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statCardValue: { fontSize: 24, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  statCardLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  featureCard: { borderRadius: 16, padding: 16, gap: 12 },
  featureHeading: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginBottom: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16,
  },
  ctaText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },

  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  loadingWrap: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  proChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.primary, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  proChipText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.primaryForeground, letterSpacing: 0.5 },

  // ── Dashboard ────────────────────────────────────────────────────────────────
  dashHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  dashHeaderLeft: { flex: 1, gap: 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  liveLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#22C55E', letterSpacing: 1.2 },
  dashTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dashEventName: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  dashEventSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  leaveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  statGrid: { flexDirection: 'row', paddingHorizontal: 12, gap: 6, marginBottom: 10 },
  statPill: {
    flex: 1, borderRadius: 12, paddingVertical: 8, alignItems: 'center', gap: 2,
  },
  statPillEmoji: { fontSize: 16 },
  statPillValue: { fontSize: 16, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  statPillLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  tabBar: { borderBottomWidth: 1, maxHeight: 42 },
  tabBarContent: { paddingHorizontal: 16, gap: 4 },
  tabItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  tabContent: { flex: 1 },
  tabContentInner: { padding: 14, gap: 10 },

  cardList: { gap: 10 },

  // Match cards
  matchCard: { borderRadius: 16, padding: 14, gap: 12 },
  matchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  matchDot: { width: 5, height: 5, borderRadius: 2.5 },
  matchBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  atEventTag: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  matchTrades: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSideRight: { flexDirection: 'row-reverse' },
  matchThumb: { width: 36, height: 36, borderRadius: 8 },
  matchSideInfo: { flex: 1, gap: 2 },
  matchSideLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 0.6 },
  matchSideName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchSideMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  matchSwapIcon: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },

  matchFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, borderTopWidth: 1 },
  matchAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  matchAvatarText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFF' },
  matchUsername: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  matchLocation: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Pro teaser
  proTeaserCard: {
    borderRadius: 18, padding: 18, borderWidth: 1.5, gap: 14,
  },
  proTeaserHeader: { flexDirection: 'row', alignItems: 'center' },
  proTeaserBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
  },
  proTeaserBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },
  proTeaserStats: { gap: 8 },
  proTeaserStatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  proTeaserStatEmoji: { fontSize: 18 },
  proTeaserStatText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  proTeaserStatHighlight: { fontFamily: 'Inter_700Bold', color: C.foreground },
  proTeaserCta: {
    backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  proTeaserCtaText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // List rows
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12 },
  listThumb: { width: 40, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  listInitial: { fontSize: 16, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  listInfo: { flex: 1, gap: 2 },
  listName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.positive },
  listRight: { alignItems: 'flex-end', gap: 4 },
  listPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  listSeller: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  availTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  availTagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  alertBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1,
  },
  alertBtnText: { fontSize: 10, fontFamily: 'Inter_500Medium' },

  boothText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  clusterRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clusterDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  clusterInitial: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFF' },
  clusterCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  haveThisBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  haveThisBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  trendRank: { fontSize: 14, fontFamily: 'Rajdhani_700Bold', color: C.mutedForeground, width: 28 },
  trendChange: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  watchText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Empty state
  emptyState: {
    borderRadius: 18, padding: 24, alignItems: 'center', gap: 10,
  },
  emptyStateTitle: { fontSize: 16, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  emptyStateBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  emptyStateCta: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4,
  },
  emptyStateCtaText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
