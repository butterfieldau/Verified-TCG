/**
 * Smart Alerts — manage and prototype price alerts.
 *
 * Active Alerts: driven by real watchlist items with priceAlertEnabled === true.
 * "Add Alert" sheet: picks an existing wishlist item without an alert and enables it.
 * Pro Preview: mock example cards showing advanced alert types (New Listing, Trade
 *   Match, Card at Event, Wishlist Appears) — clearly labelled as coming-soon Pro
 *   features, not interactive.
 *
 * Free users: up to FREE_ALERT_LIMIT active price alerts; advanced types shown with
 *   lock badges. At limit the Add Alert button is disabled but management (disable)
 *   stays fully accessible.
 * Pro users: all 6 alert types, unlimited alerts, no limit indicator.
 */
import React, { useState, useMemo } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import type { WatchlistItem, PriceAlertType } from '@/types';
import {
  canUseUnlimitedAlerts,
  FREE_ALERT_LIMIT,
} from '@/services/subscription';

const C = colors.dark;

// ── Alert type config ─────────────────────────────────────────────────────────

/** Selectable alert types — backed by actual price-monitoring logic. */
const FREE_ALERT_TYPE_OPTIONS: Array<{ id: PriceAlertType; label: string; icon: string }> = [
  { id: 'price-drop', label: 'Price Drop',  icon: 'trending-down' },
  { id: 'price-rise', label: 'Price Rise',  icon: 'trending-up'   },
];

/** Pro-only advanced types — displayed in the overview strip but NOT selectable
 *  in the Add Alert sheet (real price-polling infrastructure is out of scope). */
const PRO_ONLY_TYPES: Array<{ label: string; icon: string }> = [
  { label: 'New Listing',      icon: 'tag'      },
  { label: 'Trade Match',      icon: 'repeat'   },
  { label: 'Card at Event',    icon: 'map-pin'  },
  { label: 'Wishlist Appears', icon: 'heart'    },
];

const ALERT_TYPE_LABEL: Record<PriceAlertType, string> = {
  'price-drop': 'Price Drop',
  'price-rise': 'Price Rise',
};

// ── Pro preview mock data (clearly labelled, non-interactive) ─────────────────

interface ProExampleAlert {
  id: string;
  cardName: string;
  grade: string;
  alertType: string;
  alertTypeIcon: string;
  targetPrice: number;
  currentPrice: number;
  pctDiff: number;
  timeAgo: string;
  color: string;
}

const PRO_EXAMPLE_ALERTS: ProExampleAlert[] = [
  {
    id: 'ex1',
    cardName: 'Pikachu & Zekrom GX',
    grade: 'PSA 10',
    alertType: 'New Listing',
    alertTypeIcon: 'tag',
    targetPrice: 1100,
    currentPrice: 1050,
    pctDiff: -4.5,
    timeAgo: '2h ago',
    color: '#F5A623',
  },
  {
    id: 'ex2',
    cardName: 'Rayquaza VMAX Alt Art',
    grade: 'PSA 9',
    alertType: 'Trade Match',
    alertTypeIcon: 'repeat',
    targetPrice: 780,
    currentPrice: 755,
    pctDiff: -3.2,
    timeAgo: '2d ago',
    color: '#22C55E',
  },
  {
    id: 'ex3',
    cardName: 'Lugia V Alt Art',
    grade: 'PSA 10',
    alertType: 'Card at Event',
    alertTypeIcon: 'map-pin',
    targetPrice: 1350,
    currentPrice: 1290,
    pctDiff: -4.4,
    timeAgo: '3d ago',
    color: '#3B82F6',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

/** Real alert row — driven by an actual watchlist item with priceAlertEnabled. */
function ActiveAlertRow({
  item,
  onDisable,
}: {
  item: WatchlistItem;
  onDisable: () => void;
}) {
  const price = item.card.price.raw;
  const change = item.card.price.change7d ?? 0;
  const isUp = change >= 0;
  const atTarget = item.targetPrice ? price <= item.targetPrice : false;
  // Use stored alertType; fall back to 'price-drop' for legacy items.
  const alertType: PriceAlertType = item.alertType ?? 'price-drop';
  const alertIcon = alertType === 'price-rise' ? 'trending-up' : 'trending-down';
  const alertLabel = ALERT_TYPE_LABEL[alertType];

  return (
    <Pressable
      onPress={() => router.push(`/card/${item.card.id}` as any)}
      style={({ pressed }) => [
        styles.alertRow,
        { backgroundColor: pressed ? C.muted : C.card },
      ]}
    >
      <View style={[styles.alertStripe, { backgroundColor: C.primary }]} />
      <View style={styles.alertBody}>
        <View style={styles.alertTopRow}>
          <View style={styles.alertTypeTag}>
            <Feather name={alertIcon as any} size={11} color={C.primary} />
            <Text style={styles.alertTypeText}>{alertLabel}</Text>
          </View>
          {atTarget && (
            <View style={[styles.triggeredBadge, { backgroundColor: `${C.positive}22` }]}>
              <View style={[styles.triggeredDot, { backgroundColor: C.positive }]} />
              <Text style={[styles.triggeredText, { color: C.positive }]}>At target</Text>
            </View>
          )}
          <Pressable
            onPress={e => { e.stopPropagation?.(); onDisable(); }}
            style={styles.disableAlertBtn}
            hitSlop={8}
            accessibilityLabel="Disable alert"
          >
            <Feather name="bell-off" size={13} color={C.mutedForeground} />
          </Pressable>
        </View>

        <Text style={styles.alertCardName} numberOfLines={1}>{item.card.name}</Text>
        <Text style={styles.alertGrade}>{item.desiredGrade ?? item.card.setName}</Text>

        {item.targetPrice && (
          <View style={styles.alertPriceRow}>
            <View style={styles.alertPriceGroup}>
              <Text style={styles.alertPriceLabel}>Target</Text>
              <Text style={styles.alertPriceValue}>
                ${item.targetPrice.toLocaleString('en-AU')}
              </Text>
            </View>
            <Feather name="arrow-right" size={13} color={C.mutedForeground} />
            <View style={styles.alertPriceGroup}>
              <Text style={styles.alertPriceLabel}>Current</Text>
              <Text style={[
                styles.alertPriceValue,
                { color: atTarget ? C.positive : C.negative },
              ]}>
                ${price.toLocaleString('en-AU')}
              </Text>
            </View>
            <View style={[
              styles.pctBadge,
              { backgroundColor: isUp ? `${C.negative}22` : `${C.positive}22` },
            ]}>
              <Feather
                name={isUp ? 'trending-up' : 'trending-down'}
                size={10}
                color={isUp ? C.negative : C.positive}
              />
              <Text style={[styles.pctText, { color: isUp ? C.negative : C.positive }]}>
                {isUp ? '+' : ''}{change.toFixed(1)}% 7d
              </Text>
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Pro example row — mock data, clearly labelled as a preview. */
function ProExampleRow({ alert }: { alert: ProExampleAlert }) {
  const isBelow = alert.pctDiff < 0;
  const pctAbs = Math.abs(alert.pctDiff).toFixed(1);

  return (
    <View style={[styles.alertRow, { backgroundColor: C.card, opacity: 0.75 }]}>
      <View style={[styles.alertStripe, { backgroundColor: alert.color }]} />
      <View style={styles.alertBody}>
        <View style={styles.alertTopRow}>
          <View style={styles.alertTypeTag}>
            <Feather name={alert.alertTypeIcon as any} size={11} color={C.primary} />
            <Text style={styles.alertTypeText}>{alert.alertType}</Text>
          </View>
          <View style={[styles.exampleBadge, { backgroundColor: `${C.mutedForeground}22` }]}>
            <Text style={[styles.exampleBadgeText, { color: C.mutedForeground }]}>Example</Text>
          </View>
          <Text style={styles.alertTime}>{alert.timeAgo}</Text>
        </View>
        <Text style={styles.alertCardName} numberOfLines={1}>{alert.cardName}</Text>
        <Text style={styles.alertGrade}>{alert.grade}</Text>
        <View style={styles.alertPriceRow}>
          <View style={styles.alertPriceGroup}>
            <Text style={styles.alertPriceLabel}>Target</Text>
            <Text style={styles.alertPriceValue}>${alert.targetPrice.toLocaleString('en-AU')}</Text>
          </View>
          <Feather name="arrow-right" size={13} color={C.mutedForeground} />
          <View style={styles.alertPriceGroup}>
            <Text style={styles.alertPriceLabel}>Current</Text>
            <Text style={[styles.alertPriceValue, { color: isBelow ? C.positive : C.negative }]}>
              ${alert.currentPrice.toLocaleString('en-AU')}
            </Text>
          </View>
          <View style={[
            styles.pctBadge,
            { backgroundColor: isBelow ? `${C.positive}22` : `${C.negative}22` },
          ]}>
            <Feather
              name={isBelow ? 'trending-down' : 'trending-up'}
              size={10}
              color={isBelow ? C.positive : C.negative}
            />
            <Text style={[styles.pctText, { color: isBelow ? C.positive : C.negative }]}>
              {isBelow ? '-' : '+'}{pctAbs}% vs target
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Add Alert bottom sheet — picks a wishlist item and enables its price alert. */
function AddAlertSheet({
  onClose,
  onEnable,
  eligibleItems,
  isFree,
  activeAlertCount,
}: {
  onClose: () => void;
  onEnable: (itemId: string, alertType: PriceAlertType) => void;
  eligibleItems: WatchlistItem[];
  isFree: boolean;
  activeAlertCount: number;
}) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedAlertType, setSelectedAlertType] = useState<PriceAlertType>('price-drop');

  function handleConfirm() {
    if (!selectedItemId) return;
    onEnable(selectedItemId, selectedAlertType);
    onClose();
  }

  const canConfirm = !!selectedItemId && eligibleItems.length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.sheetOverlay}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: C.card }]}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Add Alert</Text>
          {isFree && (
            <View style={[styles.sheetLimitBadge, { backgroundColor: `${C.warning}22` }]}>
              <Text style={[styles.sheetLimitBadgeText, { color: C.warning }]}>
                {activeAlertCount} / {FREE_ALERT_LIMIT} free
              </Text>
            </View>
          )}
        </View>

        {/* Supported alert type chips — price-drop and price-rise are backed by
            actual price monitoring. Pro-only types (new listing, trade match, etc.)
            are not actionable here; they appear in the overview strip with a lock. */}
        <Text style={styles.sheetSectionLabel}>Alert Condition</Text>
        <View style={styles.alertTypeGrid}>
          {FREE_ALERT_TYPE_OPTIONS.map(type => {
            const selected = selectedAlertType === type.id;
            return (
              <Pressable
                key={type.id}
                onPress={() => setSelectedAlertType(type.id)}
                style={[
                  styles.alertTypeChip,
                  selected
                    ? { backgroundColor: C.primary, borderColor: C.primary }
                    : { backgroundColor: C.muted, borderColor: 'transparent' },
                ]}
              >
                <Feather
                  name={type.icon as any}
                  size={13}
                  color={selected ? '#FFF' : C.foreground}
                />
                <Text style={[
                  styles.alertTypeChipText,
                  { color: selected ? '#FFF' : C.foreground },
                ]}>
                  {type.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Pro-only types teaser — non-actionable, directs to upgrade */}
        <View style={[styles.proTypesTeaser, { backgroundColor: `${C.primary}0D`, borderColor: `${C.primary}22` }]}>
          <Feather name="lock" size={12} color={C.primary} />
          <Text style={styles.proTypesTeaserText}>
            Pro: New Listing, Trade Match, Card at Event, Wishlist Appears
          </Text>
          <Pressable
            onPress={() => { onClose(); router.push('/pro-subscription' as any); }}
            style={[styles.proTypesTeaserBtn, { backgroundColor: C.primary }]}
          >
            <Text style={styles.proTypesTeaserBtnText}>Upgrade</Text>
          </Pressable>
        </View>

        {/* Wishlist item picker */}
        {eligibleItems.length > 0 ? (
          <>
            <Text style={styles.sheetSectionLabel}>
              Card with Target Price
            </Text>
            <ScrollView
              style={styles.itemPickerList}
              showsVerticalScrollIndicator={false}
            >
              {eligibleItems.map(item => (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedItemId(item.id)}
                  style={[
                    styles.itemPickerRow,
                    selectedItemId === item.id && {
                      backgroundColor: `${C.primary}18`,
                      borderColor: `${C.primary}55`,
                    },
                    selectedItemId !== item.id && { backgroundColor: C.muted, borderColor: 'transparent' },
                  ]}
                >
                  <View style={[styles.itemPickerThumb, { backgroundColor: item.card.gradientStart }]}>
                    <Text style={styles.itemPickerInitial}>{item.card.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemPickerName} numberOfLines={1}>{item.card.name}</Text>
                    <Text style={styles.itemPickerMeta}>
                      {item.desiredGrade} · Target ${item.targetPrice?.toLocaleString('en-AU')}
                    </Text>
                  </View>
                  {selectedItemId === item.id && (
                    <Feather name="check-circle" size={18} color={C.primary} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : (
          <View style={[styles.noEligibleItems, { backgroundColor: C.muted }]}>
            <Feather name="info" size={15} color={C.mutedForeground} />
            <Text style={styles.noEligibleText}>
              Add a card to your Wishlist with a target price to enable a price alert on it.
            </Text>
          </View>
        )}

        {/* Footer note */}
        {isFree && activeAlertCount > 0 && (
          <Text style={styles.sheetFooterNote}>
            {activeAlertCount} of {FREE_ALERT_LIMIT} free alerts used
          </Text>
        )}

        <View style={styles.sheetActions}>
          <Pressable
            onPress={onClose}
            style={[styles.sheetCancelBtn, { backgroundColor: C.muted }]}
          >
            <Text style={[styles.sheetCancelBtnText, { color: C.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            disabled={!canConfirm}
            style={[
              styles.sheetConfirmBtn,
              { backgroundColor: canConfirm ? C.primary : C.muted },
            ]}
          >
            <Feather
              name="bell"
              size={15}
              color={canConfirm ? '#FFF' : C.mutedForeground}
            />
            <Text style={[
              styles.sheetConfirmBtnText,
              { color: canConfirm ? '#FFF' : C.mutedForeground },
            ]}>
              Enable Alert
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SmartAlertsScreen() {
  const insets = useSafeAreaInsets();
  const { watchlist, subscriptionTier, activeAlertCount, updateWatchlistItem } = useApp();
  const [showAddSheet, setShowAddSheet] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isFree = subscriptionTier === 'free';
  const hasUnlimitedAlerts = canUseUnlimitedAlerts(subscriptionTier);
  const isAtAlertLimit = isFree && activeAlertCount >= FREE_ALERT_LIMIT;

  /** Watchlist items that already have priceAlertEnabled — the real active alerts. */
  const activeAlerts = useMemo(
    () => watchlist.filter(w => w.priceAlertEnabled && !!w.targetPrice),
    [watchlist],
  );

  /** Wishlist items with a target price but no alert yet — eligible for the Add sheet. */
  const eligibleItems = useMemo(
    () => watchlist.filter(w => !!w.targetPrice && !w.priceAlertEnabled),
    [watchlist],
  );

  function handleDisableAlert(itemId: string) {
    updateWatchlistItem(itemId, { priceAlertEnabled: false });
  }

  function handleEnableAlert(itemId: string, alertType: PriceAlertType) {
    updateWatchlistItem(itemId, { priceAlertEnabled: true, alertType });
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 8, paddingBottom: 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.title}>Smart Alerts</Text>
          {!isFree && (
            <View style={[styles.proBadge, { backgroundColor: C.primary }]}>
              <Text style={styles.proBadgeText}>PRO</Text>
            </View>
          )}
        </View>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {isFree
            ? `Get notified when card prices drop or rise. Up to ${FREE_ALERT_LIMIT} free alerts — upgrade to Pro for unlimited.`
            : 'Unlimited price-drop and price-rise alerts on any wishlist card. New Listing, Trade Match, and Event alert types are coming soon.'}
        </Text>

        {/* Alert type overview chips (horizontal scroll — always visible).
            Free-supported types open the Add Alert sheet; Pro-only types show a
            lock and route to upgrade when tapped. */}
        <View style={styles.typesSection}>
          <Text style={styles.sectionLabel}>Alert Types</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.typesRow}
          >
            {FREE_ALERT_TYPE_OPTIONS.map(type => (
              <Pressable
                key={type.id}
                onPress={() => { if (!isAtAlertLimit) setShowAddSheet(true); }}
                style={[
                  styles.typeOverviewChip,
                  { backgroundColor: `${C.primary}22`, borderColor: `${C.primary}44` },
                ]}
              >
                <Feather name={type.icon as any} size={13} color={C.primary} />
                <Text style={[styles.typeOverviewChipText, { color: C.foreground }]}>
                  {type.label}
                </Text>
              </Pressable>
            ))}
            {PRO_ONLY_TYPES.map(type => (
              <Pressable
                key={type.label}
                onPress={() => {
                  // Free → upgrade prompt; Pro → coming-soon (no action needed)
                  if (isFree) router.push('/pro-subscription' as any);
                }}
                style={[
                  styles.typeOverviewChip,
                  { backgroundColor: C.muted, borderColor: 'transparent' },
                ]}
              >
                <Feather name={type.icon as any} size={13} color={C.mutedForeground} />
                <Text style={[styles.typeOverviewChipText, { color: C.mutedForeground }]}>
                  {type.label}
                </Text>
                {isFree
                  ? <Feather name="lock" size={10} color={C.mutedForeground} />
                  : <Text style={styles.comingSoonLabel}>Soon</Text>
                }
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Add Alert button — or limit gate (management still accessible above) */}
        {isAtAlertLimit ? (
          <View style={[styles.limitGate, { backgroundColor: C.card, borderColor: `${C.primary}33` }]}>
            <View style={styles.limitGateTop}>
              <View style={[styles.limitGateIconWrap, { backgroundColor: `${C.primary}22` }]}>
                <Feather name="lock" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.limitGateTitle}>Free limit reached</Text>
                <Text style={styles.limitGateCount}>
                  {FREE_ALERT_LIMIT} / {FREE_ALERT_LIMIT} active · disable an alert below to add a new one
                </Text>
              </View>
            </View>
            <Text style={styles.limitGateBody}>
              Upgrade to Pro for unlimited Smart Alerts — plus new listing, trade match, event
              availability, and wishlist card tracking.
            </Text>
            <Pressable
              onPress={() => router.push('/pro-subscription' as any)}
              style={[styles.limitGateCTA, { backgroundColor: C.primary }]}
            >
              <Feather name="zap" size={15} color="#FFF" />
              <Text style={styles.limitGateCTAText}>Unlock Unlimited Alerts</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowAddSheet(true)}
            style={[
              styles.addAlertBtn,
              { backgroundColor: eligibleItems.length === 0 ? C.muted : C.primary },
            ]}
            disabled={eligibleItems.length === 0}
          >
            <Feather name="plus" size={16} color={eligibleItems.length === 0 ? C.mutedForeground : '#FFF'} />
            <Text style={[
              styles.addAlertBtnText,
              { color: eligibleItems.length === 0 ? C.mutedForeground : '#FFF' },
            ]}>
              {eligibleItems.length === 0 ? 'Add a wishlist card with target price first' : 'Add Alert'}
            </Text>
            {isFree && eligibleItems.length > 0 && (
              <View style={[styles.addAlertFreeNote, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Text style={styles.addAlertFreeNoteText}>
                  {activeAlertCount} / {FREE_ALERT_LIMIT}
                </Text>
              </View>
            )}
          </Pressable>
        )}

        {/* ── Active alerts (real data) ── */}
        <Text style={styles.sectionLabel}>
          Active Alerts {activeAlerts.length > 0 ? `(${activeAlerts.length})` : ''}
        </Text>

        {activeAlerts.length === 0 ? (
          <View style={[styles.emptyAlerts, { backgroundColor: C.card }]}>
            <Feather name="bell-off" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyAlertsTitle}>No active alerts</Text>
            <Text style={styles.emptyAlertsBody}>
              Add a wishlist card with a target price, then tap "Add Alert" to start monitoring it.
            </Text>
          </View>
        ) : (
          activeAlerts.map(item => (
            <ActiveAlertRow
              key={item.id}
              item={item}
              onDisable={() => handleDisableAlert(item.id)}
            />
          ))
        )}

        {/* ── Pro preview (mock examples — non-interactive) ── */}
        {isFree && (
          <>
            <View style={styles.proPreviewHeader}>
              <Text style={styles.sectionLabel}>Pro Alert Types — Preview</Text>
              <Pressable
                onPress={() => router.push('/pro-subscription' as any)}
                style={[styles.proPreviewBadge, { backgroundColor: C.primary }]}
              >
                <Feather name="zap" size={10} color="#FFF" />
                <Text style={styles.proPreviewBadgeText}>Upgrade</Text>
              </Pressable>
            </View>
            <Text style={styles.proPreviewNote}>
              Example alerts — what Pro looks like for Trade Match, New Listing, and Event alerts.
            </Text>
            {PRO_EXAMPLE_ALERTS.map(alert => (
              <ProExampleRow key={alert.id} alert={alert} />
            ))}
          </>
        )}
      </ScrollView>

      {/* Add alert bottom sheet */}
      {showAddSheet && (
        <AddAlertSheet
          onClose={() => setShowAddSheet(false)}
          onEnable={handleEnableAlert}
          eligibleItems={eligibleItems}
          isFree={isFree}
          activeAlertCount={activeAlertCount}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, marginBottom: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    flex: 1, fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground, letterSpacing: -0.3,
  },
  proBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  proBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 0.5 },

  subtitle: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 20, marginBottom: 18,
  },

  // Alert type overview
  typesSection: { marginBottom: 18 },
  typesRow: { gap: 8, paddingBottom: 4 },
  typeOverviewChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  typeOverviewChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  comingSoonLabel: {
    fontSize: 9, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold',
    color: C.mutedForeground, letterSpacing: 0.8,
    textTransform: 'uppercase', marginBottom: 10,
  },

  // Add Alert button
  addAlertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: 14, marginBottom: 20,
  },
  addAlertBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  addAlertFreeNote: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 4,
  },
  addAlertFreeNoteText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  // Limit gate
  limitGate: {
    borderRadius: 16, borderWidth: 1,
    padding: 16, marginBottom: 20, gap: 12,
  },
  limitGateTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  limitGateIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  limitGateTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  limitGateCount: {
    fontSize: 12, fontFamily: 'Inter_500Medium',
    color: C.mutedForeground, marginTop: 2,
  },
  limitGateBody: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 19,
  },
  limitGateCTA: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, height: 48, borderRadius: 12,
  },
  limitGateCTAText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Active alert rows (real)
  alertRow: {
    flexDirection: 'row', borderRadius: 14,
    overflow: 'hidden', marginBottom: 10,
  },
  alertStripe: { width: 4 },
  alertBody: { flex: 1, padding: 14, gap: 4 },
  alertTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  alertTypeTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: `${C.primary}18`, borderRadius: 6,
  },
  alertTypeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  triggeredBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
  },
  triggeredDot: { width: 5, height: 5, borderRadius: 3 },
  triggeredText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  disableAlertBtn: {
    marginLeft: 'auto',
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  alertCardName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  alertGrade: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  alertPriceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
    flexWrap: 'wrap',
  },
  alertPriceGroup: { gap: 1 },
  alertPriceLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  alertPriceValue: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  pctBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, marginLeft: 'auto',
  },
  pctText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  alertTime: {
    fontSize: 10, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, marginLeft: 'auto',
  },

  // Example badge (Pro preview rows)
  exampleBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  exampleBadgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },

  // Empty state
  emptyAlerts: {
    borderRadius: 14, padding: 24,
    alignItems: 'center', gap: 10, marginBottom: 20,
  },
  emptyAlertsTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyAlertsBody: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, textAlign: 'center', lineHeight: 19,
  },

  // Pro preview section
  proPreviewHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 6,
  },
  proPreviewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
  },
  proPreviewBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },
  proPreviewNote: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, marginBottom: 10, lineHeight: 18,
  },

  // Pro types teaser (in the Add Alert sheet)
  proTypesTeaser: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 10,
  },
  proTypesTeaserText: {
    flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 17,
  },
  proTypesTeaserBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  proTypesTeaserBtnText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Add alert sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, gap: 14,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: 4,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  sheetLimitBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  sheetLimitBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  sheetSectionLabel: {
    fontSize: 11, fontFamily: 'Inter_700Bold',
    color: C.mutedForeground, letterSpacing: 0.8, textTransform: 'uppercase',
  },

  alertTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  alertTypeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5,
  },
  alertTypeChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chipLockBadge: {
    width: 18, height: 18, borderRadius: 5,
    alignItems: 'center', justifyContent: 'center',
  },

  proChipPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  proChipPromptText: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 18,
  },
  proChipPromptBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  proChipPromptBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Item picker
  itemPickerList: { maxHeight: 180 },
  itemPickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1.5, padding: 10, marginBottom: 8,
  },
  itemPickerThumb: {
    width: 36, height: 50, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  itemPickerInitial: { fontSize: 15, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  itemPickerName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  itemPickerMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },

  noEligibleItems: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, padding: 14,
  },
  noEligibleText: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 19,
  },

  sheetFooterNote: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, textAlign: 'center',
  },

  sheetActions: { flexDirection: 'row', gap: 10 },
  sheetCancelBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetCancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sheetConfirmBtn: {
    flex: 2, height: 50, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  sheetConfirmBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});
