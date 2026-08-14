import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const C = colors.dark;

interface FAQEntry {
  q: string;
  a: string;
}

interface FAQCategory {
  id: string;
  label: string;
  icon: string;
  entries: FAQEntry[];
}

const FAQ_CATEGORIES: FAQCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: 'play-circle',
    entries: [
      {
        q: 'What is Verified TCG?',
        a: 'Verified TCG is a platform for trading card game collectors to track their collections, verify card authenticity, monitor market prices, and connect with other collectors for trades.',
      },
      {
        q: 'Do I need an account to use the app?',
        a: 'You can browse as a guest, but creating a free account lets you sync your collection across devices, set price alerts, participate in trades, and unlock more features.',
      },
      {
        q: 'Which TCGs are supported?',
        a: 'We currently support Pokémon TCG, Magic: The Gathering, Yu-Gi-Oh!, Dragon Ball Super, One Piece TCG, and Flesh and Blood. More games are added regularly.',
      },
      {
        q: 'How do I add cards to my collection?',
        a: 'Tap the Scan tab to scan a card\'s barcode or photograph, or use the Search tab to find a card manually and add it from the card detail page.',
      },
      {
        q: 'Is Verified TCG free?',
        a: 'The core app is free. Verified Pro unlocks unlimited scans, advanced portfolio analytics, price alerts, trade matching, and exclusive collector perks.',
      },
    ],
  },
  {
    id: 'collection',
    label: 'Collection',
    icon: 'layers',
    entries: [
      {
        q: 'How do I remove a card from my collection?',
        a: 'Open the card in your collection, tap the three-dot menu or swipe left on the card row, then tap "Remove from Collection".',
      },
      {
        q: 'Can I track foil or special editions separately?',
        a: 'Yes — when adding a card you can select the specific variant (holo, reverse holo, first edition, etc.) and Verified TCG tracks them as distinct items.',
      },
      {
        q: 'How is my collection value calculated?',
        a: 'Collection value is based on the latest market price data from our pricing partners. Prices are refreshed regularly and you can pull-to-refresh for the latest data.',
      },
      {
        q: 'Can I export my collection?',
        a: 'Collection export is available from Settings → Data & Account → Export My Data. We support CSV format for use in spreadsheets.',
      },
      {
        q: 'Will my collection sync across devices?',
        a: 'Yes — with a Verified TCG account, your collection is stored securely and syncs automatically across all your devices.',
      },
    ],
  },
  {
    id: 'scanner',
    label: 'Card Scanner',
    icon: 'camera',
    entries: [
      {
        q: 'How does the card scanner work?',
        a: 'Point your camera at a card — our scanner recognises the card art and set details using image recognition and matches it to our database of millions of cards.',
      },
      {
        q: 'Why isn\'t my card being recognised?',
        a: 'Ensure good lighting and hold the card flat. Damaged, heavily played, or altered cards can be harder to recognise. Try the manual search as a fallback.',
      },
      {
        q: 'How many scans do I get on the free plan?',
        a: 'Free accounts receive 30 scans per calendar month. Verified Pro members get unlimited scans.',
      },
      {
        q: 'Can I scan graded cards?',
        a: 'Yes — our scanner can read cards inside PSA, BGS, and CGC slabs. Hold the slab at a slight angle to reduce glare from the case.',
      },
    ],
  },
  {
    id: 'pricing',
    label: 'Pricing & Market',
    icon: 'trending-up',
    entries: [
      {
        q: 'Where does the price data come from?',
        a: 'We aggregate pricing from multiple sources including recent eBay sales, TCGPlayer, Card Market, and other major platforms to give you an accurate market value.',
      },
      {
        q: 'How often are prices updated?',
        a: 'Prices are updated daily. Pull down on the Market or Collection screen to fetch the latest prices at any time.',
      },
      {
        q: 'What currency are prices shown in?',
        a: 'Prices default to AUD. You can change your preferred currency in Settings → General → Currency. Conversion rates are approximate and updated periodically.',
      },
      {
        q: 'What does "Market Mover" mean?',
        a: 'Market Movers are cards that have had significant price movement (up or down) in the past 24 hours, typically driven by tournament results, set releases, or collector interest.',
      },
    ],
  },
  {
    id: 'grading',
    label: 'Grading',
    icon: 'award',
    entries: [
      {
        q: 'What grading companies does Verified TCG support?',
        a: 'We support PSA, BGS (Beckett), CGC, and ACE grading labels. You can record and verify grades on cards in your collection.',
      },
      {
        q: 'How do I verify a PSA certificate?',
        a: 'From a card\'s detail page, tap "Verify Grade" and enter the PSA cert number. We check it against PSA\'s public database and confirm the match.',
      },
      {
        q: 'Can I track ungraded cards too?',
        a: 'Absolutely — most collectors track raw (ungraded) cards. You can optionally set a condition label (Near Mint, Lightly Played, etc.) for your own reference.',
      },
    ],
  },
  {
    id: 'verified-pro',
    label: 'Verified Pro',
    icon: 'star',
    entries: [
      {
        q: 'What\'s included in Verified Pro?',
        a: 'Verified Pro includes unlimited card scans, advanced portfolio analytics, unlimited price alerts, priority trade matching, Verified Drops access, Pro Perks partner discounts, and exclusive app icon and profile themes.',
      },
      {
        q: 'How do I upgrade to Pro?',
        a: 'Go to Profile → Pro Benefits → Upgrade, or Settings → Account → Payment Methods. Pro is available as a monthly or annual subscription.',
      },
      {
        q: 'Can I cancel my Pro subscription?',
        a: 'Yes — you can cancel anytime from Settings → Account → Payment Methods. You\'ll keep Pro benefits until the end of your billing period.',
      },
    ],
  },
  {
    id: 'event-mode',
    label: 'Event Mode',
    icon: 'zap',
    entries: [
      {
        q: 'What is Event Mode?',
        a: 'Event Mode is a live trading assistant designed for card shows and tournaments. It helps you quickly see what cards you need, broadcast what you\'re offering, and connect with nearby collectors.',
      },
      {
        q: 'Does Event Mode work offline?',
        a: 'Core Event Mode features require an internet connection for real-time matching. Your wishlist and collection data is cached locally for quick reference even offline.',
      },
      {
        q: 'How do I show my QR code for trading?',
        a: 'Go to Profile → Trade QR to display your personal trading QR code. Other collectors can scan it to see your available cards and wishlist.',
      },
    ],
  },
  {
    id: 'trade-match',
    label: 'Trade Match',
    icon: 'git-branch',
    entries: [
      {
        q: 'How does Trade Match work?',
        a: 'Trade Match analyses your collection and wishlist against other collectors\' data to find mutually beneficial trade opportunities — where you have what they want and vice versa.',
      },
      {
        q: 'Is my collection visible to other collectors?',
        a: 'You control your privacy. Go to Settings → Privacy to manage whether your collection, wishlist, and for-trade cards are visible to other collectors.',
      },
      {
        q: 'How do I propose a trade?',
        a: 'From the Trade Matches screen, tap a match to see the suggested trade. Tap "Propose Trade" to send the offer. The other collector will be notified.',
      },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    icon: 'user',
    entries: [
      {
        q: 'How do I change my password?',
        a: 'Go to Settings → Security → Change Password, or use the Forgot Password link on the sign-in screen.',
      },
      {
        q: 'How do I update my profile?',
        a: 'Tap the edit icon on your Profile tab, or go to Settings → Account → Edit Profile.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Go to Settings → Data & Account → Delete Account. This permanently removes your account, collection, and all data after a confirmation step.',
      },
      {
        q: 'Can I use the app without creating an account?',
        a: 'Yes — guest mode lets you browse the market, use the scanner (limited), and explore the app. Your data won\'t be saved between sessions without an account.',
      },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: 'shield',
    entries: [
      {
        q: 'What data does Verified TCG collect?',
        a: 'We collect your email, display name, and collection data to provide the service. Detailed information is in our Privacy Policy.',
      },
      {
        q: 'Can other collectors see my collection value?',
        a: 'No — your portfolio value is never shared publicly. You can control whether your card list, wishlist, and trade availability are visible in Settings → Privacy.',
      },
      {
        q: 'How do I request a copy of my data?',
        a: 'Go to Settings → Data & Account → Export My Data. We\'ll prepare a download with your collection and account information.',
      },
    ],
  },
  {
    id: 'technical',
    label: 'Technical Support',
    icon: 'tool',
    entries: [
      {
        q: 'The app is crashing — what should I do?',
        a: 'Force-close the app and reopen it. If the problem persists, try signing out and back in. For ongoing issues, contact support with a description of what happened.',
      },
      {
        q: 'Prices aren\'t loading — how do I fix it?',
        a: 'Check your internet connection and pull down to refresh. If prices still don\'t load, the pricing service may be temporarily unavailable — try again in a few minutes.',
      },
      {
        q: 'My collection disappeared after an update — help!',
        a: 'If you were signed in, your collection is safely stored on our servers — sign out and back in to restore it. If you were in guest mode, collection data may have been cleared during the update.',
      },
      {
        q: 'How do I report a bug?',
        a: 'Use the Contact Support option below to send us a bug report. Please include your device model, OS version, and a description of the steps to reproduce the issue.',
      },
    ],
  },
];

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [query, setQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);

  const lowerQuery = query.toLowerCase().trim();

  // Filter categories and entries
  const filteredCategories = FAQ_CATEGORIES.map(cat => ({
    ...cat,
    entries: cat.entries.filter(
      e =>
        !lowerQuery ||
        e.q.toLowerCase().includes(lowerQuery) ||
        e.a.toLowerCase().includes(lowerQuery),
    ),
  })).filter(cat => !lowerQuery || cat.entries.length > 0);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Help & Support</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search */}
      <View style={[styles.searchBar, { backgroundColor: C.card }]}>
        <Feather name="search" size={16} color={C.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: C.foreground }]}
          placeholder="Search FAQ…"
          placeholderTextColor={C.mutedForeground}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={C.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Contact Support CTA */}
      <Pressable
        onPress={() => router.push('/contact-support' as any)}
        style={({ pressed }) => [styles.contactCard, { opacity: pressed ? 0.8 : 1 }]}
      >
        <View style={styles.contactIcon}>
          <Feather name="message-circle" size={20} color={C.primary} />
        </View>
        <View style={styles.contactText}>
          <Text style={styles.contactTitle}>Contact Support</Text>
          <Text style={styles.contactDesc}>Send us a message — we reply within 24 hours</Text>
        </View>
        <Feather name="chevron-right" size={18} color={C.mutedForeground} />
      </Pressable>

      {/* FAQ */}
      {!lowerQuery && (
        <Text style={styles.sectionLabel}>Frequently Asked Questions</Text>
      )}

      {filteredCategories.length === 0 && (
        <View style={styles.emptyState}>
          <Feather name="search" size={32} color={C.mutedForeground} />
          <Text style={styles.emptyText}>No results for "{query}"</Text>
          <Text style={styles.emptySubtext}>Try different keywords or contact support</Text>
        </View>
      )}

      {filteredCategories.map(cat => {
        const isOpen = expandedCategory === cat.id || !!lowerQuery;
        return (
          <View key={cat.id} style={[styles.categoryCard, { backgroundColor: C.card }]}>
            {!lowerQuery && (
              <Pressable
                onPress={() => setExpandedCategory(isOpen && expandedCategory === cat.id ? null : cat.id)}
                style={({ pressed }) => [
                  styles.categoryHeader,
                  { backgroundColor: pressed ? C.muted : 'transparent' },
                ]}
              >
                <View style={styles.categoryIcon}>
                  <Feather name={cat.icon as any} size={16} color={C.primary} />
                </View>
                <Text style={styles.categoryLabel}>{cat.label}</Text>
                <Feather
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={C.mutedForeground}
                />
              </Pressable>
            )}

            {isOpen && cat.entries.map((entry, eIdx) => {
              const qKey = `${cat.id}-${eIdx}`;
              const isQOpen = expandedQuestion === qKey;
              return (
                <View key={qKey}>
                  {(eIdx > 0 || !lowerQuery) && <View style={styles.divider} />}
                  <Pressable
                    onPress={() => setExpandedQuestion(isQOpen ? null : qKey)}
                    style={({ pressed }) => [
                      styles.questionRow,
                      { backgroundColor: pressed ? C.muted : 'transparent' },
                    ]}
                  >
                    <View style={styles.questionContent}>
                      <Text style={styles.questionText}>{entry.q}</Text>
                      {isQOpen && (
                        <Text style={styles.answerText}>{entry.a}</Text>
                      )}
                    </View>
                    <Feather
                      name={isQOpen ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color={C.mutedForeground}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${C.primary}12`,
    borderWidth: 1,
    borderColor: `${C.primary}33`,
    borderRadius: 14,
    padding: 16,
    gap: 14,
    marginBottom: 20,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: `${C.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactText: { flex: 1 },
  contactTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 2 },
  contactDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  categoryCard: { borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: `${C.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 10,
  },
  questionContent: { flex: 1 },
  questionText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    lineHeight: 19,
  },
  answerText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 20,
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptySubtext: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
