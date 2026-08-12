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
import colors from '@/constants/colors';
import { MOCK_EVENT } from '@/services/matching';
import { useApp } from '@/context/AppContext';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';

const C = colors.dark;

type EventTab = 'matches' | 'wishlist' | 'want_yours' | 'for_sale' | 'trending';

const TABS: { label: string; value: EventTab }[] = [
  { label: 'Matches',   value: 'matches'    },
  { label: 'Wishlist',  value: 'wishlist'   },
  { label: 'Want Yours',value: 'want_yours' },
  { label: 'For Sale',  value: 'for_sale'   },
  { label: 'Trending',  value: 'trending'   },
];

const QUICK_ACTIONS = [
  { icon: 'search',  label: "I'm Looking For", route: '/event/looking-for' },
  { icon: 'package', label: 'I Have This',      route: '/event/have-this'  },
  { icon: 'list',    label: 'Wanted Board',     route: '/event/wanted-board'},
  { icon: 'grid',    label: 'Complete My Set',  route: '/event/complete-my-set'},
] as const;

const FREE_MATCH_LIMIT = 3;

// Teaser stats derived deterministically from MOCK_EVENT — stable across re-renders
const TEASER_COLLECTORS_WITH_WANTS = MOCK_EVENT.stats.collectorsWithYourWants;          // 17
const TEASER_EXTRA_MATCHES        = MOCK_EVENT.stats.tradeMatches * 2 + 2;              // 14
const TEASER_WANT_YOURS           = MOCK_EVENT.stats.wantYourCards * 3 - 1;             // 23

export default function EventModeScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [isInEvent, setIsInEvent] = useState(false);
  const [activeTab, setActiveTab] = useState<EventTab>('matches');
  const { watchlist, subscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  const wishlistCount = watchlist.length;
  const liveStats = {
    collectorsWithYourWants: Math.max(0, Math.round(MOCK_EVENT.stats.collectorsWithYourWants * (wishlistCount / 3))),
    tradeMatches:            Math.max(0, Math.round(MOCK_EVENT.stats.tradeMatches            * (wishlistCount / 3))),
    wishlistForSale:         Math.max(0, Math.round(MOCK_EVENT.stats.wishlistForSale         * (wishlistCount / 3))),
    wantYourCards:           MOCK_EVENT.stats.wantYourCards,
  };

  const allMatches = MOCK_EVENT.tradeMatchesAtEvent;
  const visibleMatches = isPro ? allMatches : allMatches.slice(0, FREE_MATCH_LIMIT);
  const showProTeaser = !isPro;

  const screenTitle = isPro ? 'Event Mode+' : 'Event Mode';

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
          {/* Hero card */}
          <View style={[styles.heroCard, { backgroundColor: C.card }]}>
            <View style={styles.heroBadgeRow}>
              <View style={[styles.heroBadge, { backgroundColor: `${C.primary}22` }]}>
                <View style={styles.livePulse} />
                <Text style={[styles.heroBadgeText, { color: C.primary }]}>LIVE EVENT DETECTED</Text>
              </View>
            </View>
            <Text style={styles.heroName}>{MOCK_EVENT.name}</Text>
            <Text style={styles.heroVenue}>{MOCK_EVENT.venue}</Text>
            <Text style={styles.heroCity}>{MOCK_EVENT.city} · {MOCK_EVENT.dates}</Text>
            <View style={[styles.heroDivider, { backgroundColor: C.border }]} />
            <View style={styles.heroMeta}>
              <Feather name="users" size={13} color={C.mutedForeground} />
              <Text style={styles.heroMetaText}>{MOCK_EVENT.collectorsPresent} collectors registered</Text>
            </View>
          </View>

          {/* Stats preview */}
          <Text style={styles.sectionLabel}>What's waiting for you</Text>
          {wishlistCount === 0 && (
            <Pressable
              onPress={() => router.push('/wishlist' as any)}
              style={[styles.nudge, { backgroundColor: `${C.primary}12`, borderColor: `${C.primary}33` }]}
            >
              <Feather name="heart" size={14} color={C.primary} />
              <Text style={[styles.nudgeText, { color: C.primary }]}>
                Add cards to your wishlist to see personalised event stats
              </Text>
              <Feather name="chevron-right" size={14} color={C.primary} />
            </Pressable>
          )}

          <View style={styles.statsGrid}>
            {[
              { icon: 'heart' as const,        value: liveStats.collectorsWithYourWants, label: 'Have your wants',     color: C.primary   },
              { icon: 'repeat' as const,       value: liveStats.tradeMatches,            label: 'Trade matches',       color: '#22C55E'   },
              { icon: 'tag' as const,          value: liveStats.wishlistForSale,         label: 'Wishlist for sale',   color: '#F59E0B'   },
              { icon: 'eye' as const,          value: liveStats.wantYourCards,           label: 'Want your cards',     color: '#3B82F6'   },
            ].map(s => (
              <View key={s.icon} style={[styles.statCard, { backgroundColor: C.card }]}>
                <View style={[styles.statIconWrap, { backgroundColor: `${s.color}18` }]}>
                  <Feather name={s.icon} size={16} color={s.color} />
                </View>
                <Text style={styles.statCardValue}>{s.value}</Text>
                <Text style={styles.statCardLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Feature list */}
          <View style={[styles.featureCard, { backgroundColor: C.card }]}>
            <Text style={styles.featureHeading}>Event Mode unlocks</Text>
            {([
              { icon: 'map-pin',      text: "See who's at the event with cards you want"      },
              { icon: 'repeat',       text: 'Find trade matches on the floor in real time'    },
              { icon: 'shopping-bag', text: 'Browse vendor inventory and listings'            },
              { icon: 'list',         text: 'Post to the Wanted Board for collectors to see'  },
              { icon: 'check-square', text: 'Track set completion with on-site availability'  },
            ] as const).map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.featureIconWrap, { backgroundColor: `${C.primary}18` }]}>
                  <Feather name={f.icon} size={14} color={C.primary} />
                </View>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <Pressable
            onPress={() => setIsInEvent(true)}
            style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Feather name="zap" size={18} color="#FFF" />
            <Text style={styles.ctaText}>Enter Event Mode</Text>
          </Pressable>

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
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>LIVE</Text>
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
          <Text style={styles.dashEventSub}>{MOCK_EVENT.venue} · {MOCK_EVENT.dates}</Text>
        </View>
        <Pressable
          onPress={() => setIsInEvent(false)}
          style={[styles.leaveBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}30` }]}
        >
          <Feather name="log-out" size={13} color={C.primary} />
          <Text style={[styles.leaveBtnText, { color: C.primary }]}>Leave</Text>
        </Pressable>
      </View>

      {/* ── Stat strip ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statStrip}
        contentContainerStyle={styles.statStripContent}
      >
        {([
          { emoji: '🔥', value: liveStats.collectorsWithYourWants, label: 'have your wants', tab: 'wishlist'   },
          { emoji: '🤝', value: liveStats.tradeMatches,            label: 'trade matches',   tab: 'matches'    },
          { emoji: '💰', value: liveStats.wishlistForSale,         label: 'for sale',        tab: 'for_sale'   },
          { emoji: '👀', value: liveStats.wantYourCards,           label: 'want yours',      tab: 'want_yours' },
        ] as const).map(s => (
          <Pressable
            key={s.emoji}
            onPress={() => setActiveTab(s.tab as EventTab)}
            style={[styles.statPill, { backgroundColor: C.card }, activeTab === s.tab && { borderColor: C.primary, borderWidth: 1 }]}
          >
            <Text style={styles.statPillEmoji}>{s.emoji}</Text>
            <Text style={styles.statPillValue}>{s.value}</Text>
            <Text style={styles.statPillLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Quick actions ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.qaStrip}
        contentContainerStyle={styles.qaStripContent}
      >
        {QUICK_ACTIONS.map(a => (
          <Pressable
            key={a.label}
            onPress={() => router.push(a.route as any)}
            style={({ pressed }) => [styles.qaBtn, { backgroundColor: C.card, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.qaIconWrap, { backgroundColor: `${C.primary}18` }]}>
              <Feather name={a.icon} size={16} color={C.primary} />
            </View>
            <Text style={styles.qaLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

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
            {visibleMatches.map(match => (
              <Pressable
                key={match.id}
                onPress={() => router.push('/trade-match' as any)}
                style={[styles.matchCard, { backgroundColor: C.card }]}
              >
                <View style={styles.matchHeader}>
                  <View style={[styles.matchBadge, { backgroundColor: '#22C55E18' }]}>
                    <View style={[styles.matchDot, { backgroundColor: '#22C55E' }]} />
                    <Text style={[styles.matchBadgeText, { color: '#22C55E' }]}>{match.matchPercent}% Match</Text>
                  </View>
                  <Text style={styles.atEventTag}>AT THIS EVENT</Text>
                </View>

                <View style={styles.matchTrades}>
                  <View style={styles.matchSide}>
                    <View style={[styles.matchThumb, { backgroundColor: match.youWant.color }]} />
                    <View style={styles.matchSideInfo}>
                      <Text style={styles.matchSideLabel}>YOU WANT</Text>
                      <Text style={styles.matchSideName} numberOfLines={1}>{match.youWant.name}</Text>
                      <Text style={styles.matchSideMeta}>{match.youWant.grade} · ${match.youWant.value.toLocaleString()}</Text>
                    </View>
                  </View>
                  <View style={[styles.matchSwapIcon, { backgroundColor: C.background }]}>
                    <Feather name="repeat" size={12} color={C.mutedForeground} />
                  </View>
                  <View style={[styles.matchSide, styles.matchSideRight]}>
                    <View style={styles.matchSideInfo}>
                      <Text style={[styles.matchSideLabel, { textAlign: 'right' }]}>THEY WANT</Text>
                      <Text style={[styles.matchSideName, { textAlign: 'right' }]} numberOfLines={1}>{match.theyWant.name}</Text>
                      <Text style={[styles.matchSideMeta, { textAlign: 'right' }]}>{match.theyWant.grade} · ${match.theyWant.value.toLocaleString()}</Text>
                    </View>
                    <View style={[styles.matchThumb, { backgroundColor: match.theyWant.color }]} />
                  </View>
                </View>

                <View style={[styles.matchFooter, { borderTopColor: C.border }]}>
                  <View style={[styles.matchAvatar, { backgroundColor: match.collector.avatarColor }]}>
                    <Text style={styles.matchAvatarText}>{match.collector.initials}</Text>
                  </View>
                  <Text style={styles.matchUsername}>@{match.collector.username}</Text>
                  {match.collector.isVerified && (
                    <Feather name="check-circle" size={11} color={C.positive} />
                  )}
                  <View style={{ flex: 1 }} />
                  <Text style={styles.matchLocation}>{match.collector.location}</Text>
                  <Feather name="chevron-right" size={14} color={C.mutedForeground} />
                </View>
              </Pressable>
            ))}

            {/* Pro teaser card — always shown for Free users */}
            {showProTeaser && (
              <View style={[styles.proTeaserCard, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}>
                <View style={styles.proTeaserHeader}>
                  <View style={[styles.proTeaserBadge, { backgroundColor: C.primary }]}>
                    <Feather name="zap" size={11} color={C.primaryForeground} />
                    <Text style={styles.proTeaserBadgeText}>Event Mode+</Text>
                  </View>
                </View>

                <View style={styles.proTeaserStats}>
                  <View style={styles.proTeaserStatRow}>
                    <Text style={styles.proTeaserStatEmoji}>🔥</Text>
                    <Text style={styles.proTeaserStatText}>
                      <Text style={styles.proTeaserStatHighlight}>{TEASER_COLLECTORS_WITH_WANTS} collectors</Text>
                      {' '}here have cards you want
                    </Text>
                  </View>
                  <View style={styles.proTeaserStatRow}>
                    <Text style={styles.proTeaserStatEmoji}>🤝</Text>
                    <Text style={styles.proTeaserStatText}>
                      <Text style={styles.proTeaserStatHighlight}>+{TEASER_EXTRA_MATCHES} more Trade Matches</Text>
                      {' '}with Pro
                    </Text>
                  </View>
                  <View style={styles.proTeaserStatRow}>
                    <Text style={styles.proTeaserStatEmoji}>👀</Text>
                    <Text style={styles.proTeaserStatText}>
                      <Text style={styles.proTeaserStatHighlight}>{TEASER_WANT_YOURS} collectors</Text>
                      {' '}want your cards
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

            {isPro && (
              <Pressable
                onPress={() => router.push('/trade-match' as any)}
                style={[styles.viewAllRow, { borderColor: C.border }]}
              >
                <Text style={[styles.viewAllText, { color: C.mutedForeground }]}>View All Trade Matches</Text>
                <Feather name="arrow-right" size={13} color={C.mutedForeground} />
              </Pressable>
            )}
          </View>
        )}

        {/* WISHLIST NEARBY */}
        {activeTab === 'wishlist' && (
          <ProFeaturePreview
            featureTitle="Wishlist Nearby"
            description="See which collectors and vendors at this event have your wishlisted cards available right now."
            previewContent={
              <View style={styles.cardList}>
                {MOCK_EVENT.wishlistNearby.slice(0, 2).map(item => (
                  <View key={item.id} style={[styles.listRow, { backgroundColor: C.card }]}>
                    <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                      <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{item.cardName}</Text>
                      <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                      <Text style={styles.listValue}>${item.value.toLocaleString('en-AU')}</Text>
                    </View>
                    <View style={styles.listRight}>
                      <View style={[styles.availTag, { backgroundColor: `${C.positive}18` }]}>
                        <Text style={[styles.availTagText, { color: C.positive }]}>{item.availableCount} avail.</Text>
                      </View>
                      <Text style={styles.listSeller}>@{item.sellerUsername}</Text>
                    </View>
                  </View>
                ))}
              </View>
            }
            lockedContent={
              <View style={styles.cardList}>
                {MOCK_EVENT.wishlistNearby.map(item => (
                  <View key={item.id} style={[styles.listRow, { backgroundColor: C.card }]}>
                    <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                      <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{item.cardName}</Text>
                      <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                      <Text style={styles.listValue}>${item.value.toLocaleString('en-AU')}</Text>
                    </View>
                    <View style={styles.listRight}>
                      <View style={[styles.availTag, { backgroundColor: `${C.positive}18` }]}>
                        <Text style={[styles.availTagText, { color: C.positive }]}>{item.availableCount} avail.</Text>
                      </View>
                      <Text style={styles.listSeller}>@{item.sellerUsername}</Text>
                      {item.sellerVerified && <Feather name="check-circle" size={10} color={C.positive} />}
                    </View>
                  </View>
                ))}
              </View>
            }
            ctaLabel="Unlock Wishlist Nearby with Pro"
          />
        )}

        {/* WANT YOUR CARDS */}
        {activeTab === 'want_yours' && (
          <ProFeaturePreview
            featureTitle="People Want Your Cards"
            description="Discover which collectors at this event are actively looking for cards you own — perfect for trades."
            previewContent={
              <View style={styles.cardList}>
                {MOCK_EVENT.wantYourCards.slice(0, 1).map(item => (
                  <View key={item.id} style={[styles.listRow, { backgroundColor: C.card }]}>
                    <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                      <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{item.cardName}</Text>
                      <Text style={styles.listMeta}>{item.grade}</Text>
                      <View style={styles.clusterRow}>
                        {item.collectors.slice(0, 2).map(c => (
                          <View key={c.username} style={[styles.clusterDot, { backgroundColor: c.color }]}>
                            <Text style={styles.clusterInitial}>{c.initials[0]}</Text>
                          </View>
                        ))}
                        <Text style={styles.clusterCount}>{item.collectors.length} collectors</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            }
            lockedContent={
              <View style={styles.cardList}>
                {MOCK_EVENT.wantYourCards.map(item => (
                  <View key={item.id} style={[styles.listRow, { backgroundColor: C.card }]}>
                    <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                      <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                    </View>
                    <View style={styles.listInfo}>
                      <Text style={styles.listName}>{item.cardName}</Text>
                      <Text style={styles.listMeta}>{item.grade}</Text>
                      <View style={styles.clusterRow}>
                        {item.collectors.slice(0, 3).map(c => (
                          <View key={c.username} style={[styles.clusterDot, { backgroundColor: c.color }]}>
                            <Text style={styles.clusterInitial}>{c.initials[0]}</Text>
                          </View>
                        ))}
                        <Text style={styles.clusterCount}>{item.collectors.length} collectors</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => router.push('/event/have-this' as any)}
                      style={[styles.haveThisBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}30` }]}
                    >
                      <Text style={[styles.haveThisBtnText, { color: C.primary }]}>I Have This</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            }
            ctaLabel="Unlock People Want Your Cards with Pro"
          />
        )}

        {/* FOR SALE */}
        {activeTab === 'for_sale' && (
          <View style={styles.cardList}>
            {MOCK_EVENT.forSaleAtEvent.map(item => (
              <Pressable
                key={item.id}
                onPress={() => item.vendorId
                  ? router.push(`/vendor/${item.vendorId}` as any)
                  : router.push(`/collector/${item.sellerUsername}` as any)
                }
                style={[styles.listRow, { backgroundColor: C.card }]}
              >
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                  {item.booth && (
                    <Text style={[styles.boothText, { color: C.primary }]}>{item.booth}</Text>
                  )}
                </View>
                <View style={styles.listRight}>
                  <Text style={styles.listPrice}>${item.askingPrice.toLocaleString('en-AU')}</Text>
                  <Text style={styles.listSeller}>@{item.sellerUsername}</Text>
                  {item.sellerVerified && <Feather name="check-circle" size={10} color={C.positive} />}
                  {/* Price alert button */}
                  {isPro ? (
                    <Pressable
                      onPress={() => {}}
                      style={[styles.alertBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}30` }]}
                    >
                      <Feather name="bell" size={10} color={C.primary} />
                      <Text style={[styles.alertBtnText, { color: C.primary }]}>Alert</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => router.push('/pro-subscription' as any)}
                      style={[styles.alertBtn, { backgroundColor: C.muted, borderColor: C.border }]}
                    >
                      <Feather name="lock" size={10} color={C.mutedForeground} />
                      <Text style={[styles.alertBtnText, { color: C.mutedForeground }]}>Alert</Text>
                    </Pressable>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* TRENDING */}
        {activeTab === 'trending' && (
          <View style={styles.cardList}>
            {MOCK_EVENT.trending.map((item, i) => (
              <View key={item.id} style={[styles.listRow, { backgroundColor: C.card }]}>
                <Text style={styles.trendRank}>#{i + 1}</Text>
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                  <View style={styles.watchRow}>
                    <Feather name="eye" size={10} color={C.mutedForeground} />
                    <Text style={styles.watchText}>{item.watchers} watching</Text>
                  </View>
                </View>
                <Text style={[styles.trendChange, { color: C.positive }]}>{item.change}</Text>
              </View>
            ))}
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
  heroCity: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  heroDivider: { width: '100%', height: 1, marginVertical: 4 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  sectionLabel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },

  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  nudgeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', borderRadius: 16, padding: 16, alignItems: 'center', gap: 6 },
  statIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statCardValue: { fontSize: 30, fontFamily: 'Rajdhani_700Bold', color: C.foreground, lineHeight: 34 },
  statCardLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  featureCard: { borderRadius: 16, padding: 18, gap: 14 },
  featureHeading: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 56, borderRadius: 16, backgroundColor: C.primary,
  },
  ctaText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFF' },

  disclaimer: {
    fontSize: 11, fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}66`, textAlign: 'center', lineHeight: 17,
  },

  // ── Active dashboard ──────────────────────────────────────────────────────────
  dashHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  dashHeaderLeft: { flex: 1, gap: 2, marginRight: 12 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.positive },
  liveLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.positive, letterSpacing: 1.2 },
  dashTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dashEventName: { fontSize: 18, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  dashEventSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  leaveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // Pro chip
  proChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.primary, borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  proChipText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.primaryForeground, letterSpacing: 0.5 },

  // Stat strip
  statStrip: { flexGrow: 0, flexShrink: 0, height: 94 },
  statStripContent: { paddingHorizontal: 20, gap: 10, paddingBottom: 12 },
  statPill: {
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
    alignItems: 'center', gap: 2, minWidth: 80,
  },
  statPillEmoji: { fontSize: 16 },
  statPillValue: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, lineHeight: 26 },
  statPillLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  // Quick actions
  qaStrip: { flexGrow: 0, flexShrink: 0, height: 60 },
  qaStripContent: { paddingHorizontal: 20, gap: 10, paddingBottom: 12 },
  qaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  qaIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },

  // Tab bar — height must equal tab item height (paddingTop + text + paddingBottom + border) + own border
  tabBar: { borderBottomWidth: 1, height: 29, flexShrink: 0 },
  tabBarContent: { paddingHorizontal: 16 },
  tabItem: {
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 0,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },

  // Tab content
  tabContent: { flex: 1 },
  tabContentInner: { paddingHorizontal: 16, paddingTop: 10 },
  cardList: { gap: 10 },

  // Match cards
  matchCard: { borderRadius: 16, padding: 14, gap: 12 },
  matchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  matchDot: { width: 5, height: 5, borderRadius: 3 },
  matchBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  atEventTag: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1 },
  matchTrades: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSideRight: { justifyContent: 'flex-end' },
  matchThumb: { width: 34, height: 48, borderRadius: 6, flexShrink: 0 },
  matchSideInfo: { flex: 1 },
  matchSideLabel: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1, marginBottom: 2 },
  matchSideName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchSideMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },
  matchSwapIcon: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
  },
  matchFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 10, borderTopWidth: 1,
  },
  matchAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  matchAvatarText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFF' },
  matchUsername: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchLocation: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  viewAllRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 12, paddingVertical: 12, borderWidth: 1, marginTop: 2,
  },
  viewAllText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Pro teaser card
  proTeaserCard: {
    borderRadius: 18, borderWidth: 1.5,
    overflow: 'hidden', marginTop: 2,
  },
  proTeaserHeader: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
  },
  proTeaserBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  proTeaserBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primaryForeground, letterSpacing: 0.3 },
  proTeaserStats: { paddingHorizontal: 16, gap: 10, paddingBottom: 16 },
  proTeaserStatRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  proTeaserStatEmoji: { fontSize: 18, width: 26, textAlign: 'center' },
  proTeaserStatText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  proTeaserStatHighlight: { fontFamily: 'Inter_700Bold', color: C.foreground },
  proTeaserCta: {
    margin: 12, marginTop: 0,
    backgroundColor: C.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  proTeaserCtaText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.primaryForeground },

  // List rows (shared across Wishlist / Want Yours / For Sale / Trending)
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, padding: 12, gap: 12,
  },
  listThumb: {
    width: 44, height: 62, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  listInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  listInfo: { flex: 1, gap: 3 },
  listName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  listRight: { alignItems: 'flex-end', gap: 4 },
  listPrice: { fontSize: 15, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  listSeller: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  availTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  availTagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  boothText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  // Price alert button
  alertBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1,
  },
  alertBtnText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },

  // Want Yours
  clusterRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  clusterDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  clusterInitial: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFF' },
  clusterCount: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  haveThisBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  haveThisBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  // Trending
  trendRank: { fontSize: 14, fontFamily: 'Rajdhani_700Bold', color: C.mutedForeground, width: 26, textAlign: 'center' },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  watchText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  trendChange: { fontSize: 14, fontFamily: 'Inter_700Bold' },
});
