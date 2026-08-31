import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image, ImageSourcePropType, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useEffect, useMemo, useState } from 'react';

type FeedTab = 'For you' | 'Discover' | 'Inbox';

type FeedPost = {
  id: string;
  author: string;
  handle: string;
  initials: string;
  verified?: boolean;
  time: string;
  body: string;
  cardName: string;
  cardMeta: string;
  cardImage: ImageSourcePropType;
  likes: number;
  comments: number;
  avatarTone: 'rose' | 'blue' | 'slate';
  liked?: boolean;
  saved?: boolean;
  reply?: string;
};

const POSTS_KEY = '@verified-tcg-community/posts';
const SEED_POSTS: FeedPost[] = [
  {
    id: 'mara-charizard',
    author: 'Mara Chen',
    handle: '@marachens',
    initials: 'MC',
    verified: true,
    time: '18 min',
    body: 'The texture on this one is unreal in hand. Found it tucked behind a stack of commons at Nakano Broadway. A very good Saturday.',
    cardName: '1999 Base Set · Charizard Holo',
    cardMeta: 'Base Set / 4 of 102',
    cardImage: require('@/assets/images/card-charmander.png'),
    likes: 184,
    comments: 23,
    avatarTone: 'rose',
  },
  {
    id: 'jonah-mail',
    author: 'Jonah Lewis',
    handle: '@jonahpulls',
    initials: 'JL',
    verified: true,
    time: '1 hr',
    body: 'Small mail day, big feeling. The seller included the original receipt and a note from 2001. Those details matter.',
    cardName: 'Pikachu ex · Special Illustration',
    cardMeta: 'Scarlet & Violet / 238 of 198',
    cardImage: require('@/assets/images/card-holo.png'),
    likes: 96,
    comments: 11,
    avatarTone: 'blue',
  },
  {
    id: 'rhea-trade',
    author: 'Rhea Patel',
    handle: '@rheacollects',
    initials: 'RP',
    time: '3 hr',
    body: 'Trade night reminder: bring your wants list, a loupe, and patience. The best swaps start with a good conversation.',
    cardName: 'Collector note · Trade night',
    cardMeta: 'Melbourne chapter / Friday 7pm',
    cardImage: require('@/assets/images/card-holo.png'),
    likes: 71,
    comments: 8,
    avatarTone: 'slate',
  },
];

type AvatarTone = 'rose' | 'blue' | 'slate';

export default function CommunityScreen() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [activeTab, setActiveTab] = useState<FeedTab>('For you');
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [attachCard, setAttachCard] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [replyPostId, setReplyPostId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(POSTS_KEY).then((stored) => {
      if (!mounted) return;
      setPosts(stored ? JSON.parse(stored) as FeedPost[] : SEED_POSTS);
      setHydrated(true);
    }).catch(() => {
      if (mounted) {
        setPosts(SEED_POSTS);
        setHydrated(true);
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(POSTS_KEY, JSON.stringify(posts)).catch(() => undefined);
  }, [hydrated, posts]);

  const filteredPosts = posts.filter((post) =>
    `${post.author} ${post.handle} ${post.body} ${post.cardName}`.toLowerCase().includes(searchText.trim().toLowerCase()),
  );

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => current === message ? '' : current), 2200);
  };

  const pulse = async () => {
    if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleReaction = async (postId: string, key: 'liked' | 'saved') => {
    await pulse();
    setPosts((current) => current.map((post) => post.id === postId
      ? { ...post, [key]: !post[key], likes: key === 'liked' ? post.likes + (post.liked ? -1 : 1) : post.likes }
      : post));
  };

  const submitPost = async () => {
    const body = composerText.trim();
    if (!body) {
      showNotice('Write something before posting');
      return;
    }
    await pulse();
    const newPost: FeedPost = {
      id: `local-${Date.now()}`,
      author: 'You',
      handle: '@yourcollection',
      initials: 'YC',
      time: 'now',
      body,
      cardName: attachCard ? '1999 Base Set · Charizard Holo' : 'Community post',
      cardMeta: attachCard ? 'Your referenced card' : 'Collector community',
      cardImage: attachCard ? require('@/assets/images/card-charmander.png') : require('@/assets/images/card-holo.png'),
      likes: 0,
      comments: 0,
      avatarTone: 'rose',
    };
    setPosts((current) => [newPost, ...current]);
    setComposerText('');
    setComposerOpen(false);
    showNotice('Post published');
  };

  const submitReply = (postId: string) => {
    if (!replyText.trim()) return;
    setPosts((current) => current.map((post) => post.id === postId
      ? { ...post, comments: post.comments + 1, reply: replyText.trim() }
      : post));
    setReplyText('');
    setReplyPostId(null);
    showNotice('Reply added');
  };

  const sharePost = async (post: FeedPost) => {
    try {
      await Share.share({ message: `${post.cardName} — ${post.body}` });
    } catch {
      showNotice('Sharing is unavailable right now');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    setRefreshing(false);
    showNotice('Community refreshed');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><View style={styles.brandMarkInner} /></View>
          <Text style={styles.brandName}>Verified TCG</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => showNotice('You’re all caught up')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Notifications"><Feather name="bell" size={19} color={C.mutedForeground} /></Pressable>
          <Pressable onPress={() => setActiveTab('Inbox')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Open inbox"><Feather name="message-circle" size={19} color={C.mutedForeground} /></Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 30 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.date}>FRIDAY, 24 MAY</Text>
            <Text style={styles.title}>Your community</Text>
          </View>
          <Pressable onPress={() => setSearchOpen((current) => !current)} style={styles.searchButton} accessibilityRole="button" accessibilityLabel="Search community"><Feather name="search" size={23} color={C.mutedForeground} /></Pressable>
        </View>

        {searchOpen && (
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={C.mutedForeground} />
            <TextInput value={searchText} onChangeText={setSearchText} autoFocus placeholder="Search collectors and cards" placeholderTextColor={C.mutedForeground} style={styles.searchInput} />
            {!!searchText && <Pressable onPress={() => setSearchText('')}><Feather name="x-circle" size={16} color={C.mutedForeground} /></Pressable>}
          </View>
        )}

        <View style={styles.tabs}>
          {(['For you', 'Discover', 'Inbox'] as FeedTab[]).map((tab) => (
            <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, activeTab === tab && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
              {tab === 'Inbox' && <View style={styles.unread}><Text style={styles.unreadText}>2</Text></View>}
            </Pressable>
          ))}
        </View>

        {activeTab === 'For you' && (
          <>
            <Pressable style={styles.composerPrompt} onPress={() => setComposerOpen(true)} accessibilityRole="button">
              <View style={[styles.avatar, { backgroundColor: C.avatarRose }]}><Text style={styles.avatarText}>RV</Text></View>
              <View style={styles.composerCopy}><Text style={styles.composerTitle}>What are you displaying today?</Text><Text style={styles.composerSubtitle}>Share a card, a story, or a sharp eye.</Text></View>
              <View style={styles.cameraButton}><Feather name="camera" size={18} color={C.primary} /></View>
            </Pressable>
            {!hydrated ? (
              <View style={styles.loadingCard}><View style={styles.loadingLine} /><View style={[styles.loadingLine, { width: '62%' }]} /><View style={styles.loadingBlock} /></View>
            ) : filteredPosts.length > 0 ? filteredPosts.map((post) => (
              <PostCard key={post.id} post={post} styles={styles} C={C} onLike={() => toggleReaction(post.id, 'liked')} onSave={() => toggleReaction(post.id, 'saved')} onReply={() => setReplyPostId(replyPostId === post.id ? null : post.id)} onShare={() => sharePost(post)} replyOpen={replyPostId === post.id} replyText={replyText} onReplyTextChange={setReplyText} onSubmitReply={() => submitReply(post.id)} />
            )) : <EmptyState styles={styles} query={searchText} onClear={() => setSearchText('')} />}
          </>
        )}

        {activeTab === 'Discover' && <DiscoverView styles={styles} C={C} onFollow={(name: string) => showNotice(`Following ${name}`)} />}
        {activeTab === 'Inbox' && <InboxView styles={styles} C={C} onOpen={() => showNotice('Conversation opened')} />}
      </ScrollView>

      {composerOpen && <Composer styles={styles} C={C} text={composerText} setText={setComposerText} attachCard={attachCard} setAttachCard={setAttachCard} onClose={() => setComposerOpen(false)} onSubmit={submitPost} />}
      {!!notice && <View style={[styles.notice, { bottom: insets.bottom + 22 }]}><Feather name="check-circle" size={15} color={C.primary} /><Text style={styles.noticeText}>{notice}</Text></View>}
    </View>
  );
}

function PostCard({ post, styles, C, onLike, onSave, onReply, onShare, replyOpen, replyText, onReplyTextChange, onSubmitReply }: { post: FeedPost; styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; onLike: () => void; onSave: () => void; onReply: () => void; onShare: () => void; replyOpen: boolean; replyText: string; onReplyTextChange: (text: string) => void; onSubmitReply: () => void }) {
  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={[styles.avatar, { backgroundColor: avatarColor(C, post.avatarTone) }]}><Text style={styles.avatarText}>{post.initials}</Text></View>
        <View style={styles.authorCopy}><View style={styles.authorLine}><Text style={styles.authorName}>{post.author}</Text>{post.verified && <View style={styles.verified}><Feather name="check" size={8} color={C.primary} /><Text style={styles.verifiedText}>VERIFIED</Text></View>}</View><Text style={styles.handle}>{post.handle} · {post.time}</Text></View>
        <Pressable onPress={() => {}} style={styles.moreButton} accessibilityLabel="More post actions"><Feather name="more-horizontal" size={19} color={C.mutedForeground} /></Pressable>
      </View>
      <Text style={styles.postBody}>{post.body}</Text>
      <View style={styles.cardReference}>
        <Image source={post.cardImage} style={styles.cardImage} />
        <View style={styles.cardReferenceCopy}><Text style={styles.cardEyebrow}>CARD REFERENCE</Text><Text style={styles.cardName}>{post.cardName}</Text><Text style={styles.cardMeta}>{post.cardMeta}</Text><View style={styles.cardTag}><Feather name="star" size={11} color={C.primary} fill={C.primary} /><Text style={styles.cardTagText}> Holofoil · verified</Text></View></View>
      </View>
      {post.reply && <View style={styles.replyPreview}><Text style={styles.replyLabel}>YOUR REPLY</Text><Text style={styles.replyPreviewText}>{post.reply}</Text></View>}
      <View style={styles.postActions}>
        <Pressable onPress={onLike} style={styles.action} accessibilityRole="button" accessibilityLabel={post.liked ? 'Unlike post' : 'Like post'}><Feather name="heart" size={17} color={post.liked ? C.primary : C.mutedForeground} fill={post.liked ? C.primary : 'transparent'} /><Text style={styles.actionText}>{post.likes}</Text></Pressable>
        <Pressable onPress={onReply} style={styles.action} accessibilityRole="button" accessibilityLabel="Reply to post"><Feather name="message-circle" size={17} color={C.mutedForeground} /><Text style={styles.actionText}>{post.comments}</Text></Pressable>
        <View style={styles.actionSpacer} />
        <Pressable onPress={onSave} style={styles.action} accessibilityRole="button" accessibilityLabel={post.saved ? 'Remove bookmark' : 'Bookmark post'}><Feather name="bookmark" size={17} color={post.saved ? C.primary : C.mutedForeground} fill={post.saved ? C.primary : 'transparent'} /></Pressable>
        <Pressable onPress={onShare} style={styles.action} accessibilityRole="button" accessibilityLabel="Share post"><Feather name="share-2" size={17} color={C.mutedForeground} /></Pressable>
      </View>
      {replyOpen && <View style={styles.replyComposer}><TextInput value={replyText} onChangeText={onReplyTextChange} placeholder="Write a thoughtful reply..." placeholderTextColor={C.mutedForeground} style={styles.replyInput} returnKeyType="send" onSubmitEditing={onSubmitReply} /><Pressable onPress={onSubmitReply} style={styles.replySend}><Feather name="arrow-up" size={16} color={C.primaryForeground} /></Pressable></View>}
    </View>
  );
}

function DiscoverView({ styles, C, onFollow }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; onFollow: (name: string) => void }) {
  const collectors = [{ initials: 'SK', name: 'Sarah Kim', handle: '@sarahcollects', note: 'Vintage holos and clean slabs', tone: 'blue' as const }, { initials: 'DM', name: 'Diego Morales', handle: '@diegotcg', note: 'One Piece · trade night regular', tone: 'slate' as const }, { initials: 'LN', name: 'Lena Nguyen', handle: '@lenalikescards', note: 'Modern illustration rare hunter', tone: 'rose' as const }];
  return <View style={styles.discover}><Text style={styles.sectionTitle}>Find your people</Text><Text style={styles.sectionSubtitle}>Collectors worth adding to your circle.</Text>{collectors.map((collector) => <View key={collector.handle} style={styles.collectorRow}><View style={[styles.avatar, { backgroundColor: avatarColor(C, collector.tone) }]}><Text style={styles.avatarText}>{collector.initials}</Text></View><View style={styles.collectorCopy}><Text style={styles.collectorName}>{collector.name}</Text><Text style={styles.handle}>{collector.handle}</Text><Text style={styles.collectorNote}>{collector.note}</Text></View><Pressable onPress={() => onFollow(collector.name)} style={styles.followButton}><Text style={styles.followText}>Follow</Text></Pressable></View>)}<View style={styles.discoverCard}><Feather name="compass" size={20} color={C.primary} /><View style={{ flex: 1 }}><Text style={styles.discoverCardTitle}>Explore card conversations</Text><Text style={styles.discoverCardText}>Discover posts by set, game, or collecting style.</Text></View><Feather name="arrow-right" size={18} color={C.mutedForeground} /></View></View>;
}

function InboxView({ styles, C, onOpen }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; onOpen: () => void }) {
  return <View style={styles.discover}><Text style={styles.sectionTitle}>Inbox</Text><Text style={styles.sectionSubtitle}>Keep the good conversations moving.</Text>{[{ initials: 'SK', name: 'Sarah Kim', message: 'That Charizard texture is incredible.', time: '12m', unread: true, tone: 'blue' as const }, { initials: 'DM', name: 'Diego Morales', message: 'Trade night details attached.', time: '1h', unread: true, tone: 'slate' as const }, { initials: 'LN', name: 'Lena Nguyen', message: 'Thanks for the set recommendation!', time: 'yesterday', unread: false, tone: 'rose' as const }].map((message) => <Pressable key={message.name} onPress={onOpen} style={styles.messageRow}><View style={[styles.avatar, { backgroundColor: avatarColor(C, message.tone) }]}><Text style={styles.avatarText}>{message.initials}</Text></View><View style={styles.collectorCopy}><View style={styles.messageTop}><Text style={styles.collectorName}>{message.name}</Text><Text style={styles.messageTime}>{message.time}</Text></View><Text style={[styles.messageText, message.unread && styles.messageUnread]} numberOfLines={1}>{message.message}</Text></View>{message.unread && <View style={styles.unreadDot} />}</Pressable>)}</View>;
}

function avatarColor(C: ReturnType<typeof useColors>, tone: AvatarTone) {
  return tone === 'rose' ? C.avatarRose : tone === 'blue' ? C.avatarBlue : C.avatarSlate;
}

function EmptyState({ styles, query, onClear }: { styles: ReturnType<typeof makeStyles>; query: string; onClear: () => void }) {
  return <View style={styles.empty}><Feather name="search" size={24} color={styles.emptyIcon.color} /><Text style={styles.emptyTitle}>No posts found</Text><Text style={styles.emptyText}>Nothing matches “{query}”. Try another card or collector.</Text><Pressable onPress={onClear} style={styles.clearButton}><Text style={styles.clearText}>Clear search</Text></Pressable></View>;
}

function Composer({ styles, C, text, setText, attachCard, setAttachCard, onClose, onSubmit }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; text: string; setText: (text: string) => void; attachCard: boolean; setAttachCard: (value: boolean) => void; onClose: () => void; onSubmit: () => void }) {
  return <View style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} accessibilityLabel="Close composer" /><View style={[styles.composerSheet, { paddingBottom: 18 }]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Share with your community</Text><Pressable onPress={onClose} accessibilityLabel="Close"><Feather name="x" size={21} color={C.mutedForeground} /></Pressable></View><TextInput value={text} onChangeText={setText} autoFocus multiline placeholder="What are you displaying today?" placeholderTextColor={C.mutedForeground} style={styles.composerInput} /><Pressable onPress={() => setAttachCard(!attachCard)} style={[styles.attachment, attachCard && styles.attachmentActive]}><View style={styles.attachmentIcon}><Feather name="credit-card" size={15} color={attachCard ? C.primary : C.mutedForeground} /></View><View style={{ flex: 1 }}><Text style={styles.attachmentTitle}>{attachCard ? 'Card reference attached' : 'Attach a card reference'}</Text><Text style={styles.attachmentText}>{attachCard ? '1999 Base Set · Charizard Holo' : 'Help collectors follow the conversation'}</Text></View><Feather name={attachCard ? 'check-circle' : 'plus-circle'} size={19} color={attachCard ? C.primary : C.mutedForeground} /></Pressable><View style={styles.sheetActions}><Pressable onPress={onClose} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable onPress={onSubmit} style={styles.publishButton}><Feather name="send" size={15} color={C.primaryForeground} /><Text style={styles.publishText}>Publish</Text></Pressable></View></View></View>;
}

function makeStyles(C: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: C.background },
    header: { minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    brandMark: { width: 24, height: 24, borderRadius: 6, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
    brandMarkInner: { width: 10, height: 12, borderWidth: 1.5, borderColor: C.primaryForeground, borderRadius: 2 },
    brandName: { color: C.foreground, fontWeight: '700', fontSize: 16, letterSpacing: -0.3 },
    headerActions: { flexDirection: 'row', gap: 3 },
    iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    scrollContent: { paddingHorizontal: 16 },
    titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 24, paddingBottom: 14 },
    date: { fontSize: 10, letterSpacing: 2.1, color: C.mutedForeground, fontWeight: '700' },
    title: { color: C.foreground, fontSize: 28, fontWeight: '800', letterSpacing: -1.1, marginTop: 12 },
    searchButton: { padding: 7, marginBottom: 1 },
    searchBox: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 12, marginBottom: 13 },
    searchInput: { flex: 1, color: C.foreground, fontSize: 13, paddingVertical: 10 },
    tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 20 },
    tab: { paddingVertical: 12, marginRight: 24, flexDirection: 'row', gap: 6, alignItems: 'center' },
    tabActive: { borderBottomWidth: 2, borderBottomColor: C.primary },
    tabText: { color: C.mutedForeground, fontSize: 14 },
    tabTextActive: { color: C.foreground, fontWeight: '600' },
    unread: { backgroundColor: C.secondary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
    unreadText: { color: C.foreground, fontSize: 9, fontWeight: '700' },
    composerPrompt: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: C.border, backgroundColor: C.card, marginBottom: 15 },
    avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: C.foreground, fontSize: 11, fontWeight: '700' },
    composerCopy: { flex: 1, paddingHorizontal: 11 },
    composerTitle: { color: C.foreground, fontSize: 13, fontWeight: '600' },
    composerSubtitle: { color: C.mutedForeground, fontSize: 11, marginTop: 4 },
    cameraButton: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
    postCard: { borderWidth: 1, borderColor: C.border, borderRadius: 15, backgroundColor: C.card, marginBottom: 15, overflow: 'hidden' },
    postHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 9 },
    authorCopy: { flex: 1, paddingLeft: 10 },
    authorLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    authorName: { color: C.foreground, fontWeight: '700', fontSize: 13 },
    verified: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 3, backgroundColor: C.accent, paddingHorizontal: 4, paddingVertical: 2 },
    verifiedText: { color: C.primary, fontSize: 7, fontWeight: '800', letterSpacing: 0.5 },
    handle: { color: C.mutedForeground, fontSize: 10, marginTop: 3 },
    moreButton: { padding: 4 },
    postBody: { color: C.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingBottom: 13 },
    cardReference: { flexDirection: 'row', marginHorizontal: 14, borderWidth: 1, borderColor: C.border, borderRadius: 11, backgroundColor: C.surfaceStrong, overflow: 'hidden' },
    cardImage: { width: 126, height: 150, resizeMode: 'cover' },
    cardReferenceCopy: { flex: 1, padding: 12, justifyContent: 'center' },
    cardEyebrow: { color: C.mutedForeground, fontSize: 8, letterSpacing: 1.4, fontWeight: '700', marginBottom: 7 },
    cardName: { color: C.foreground, fontSize: 16, fontWeight: '800', lineHeight: 19 },
    cardMeta: { color: C.mutedForeground, fontSize: 10, marginTop: 5 },
    cardTag: { flexDirection: 'row', alignItems: 'center', marginTop: 19 },
    cardTagText: { color: C.primary, fontSize: 9, fontWeight: '600' },
    postActions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 47, borderTopWidth: 1, borderTopColor: C.border, marginTop: 13 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingRight: 17 },
    actionText: { color: C.mutedForeground, fontSize: 11 },
    actionSpacer: { flex: 1 },
    replyPreview: { marginHorizontal: 14, marginTop: 11, borderLeftWidth: 2, borderLeftColor: C.primary, paddingLeft: 9 },
    replyLabel: { color: C.primary, fontSize: 8, letterSpacing: 1, fontWeight: '700' },
    replyPreviewText: { color: C.mutedForeground, fontSize: 11, marginTop: 3 },
    replyComposer: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: C.border, padding: 10 },
    replyInput: { flex: 1, color: C.foreground, backgroundColor: C.secondary, borderRadius: 9, paddingHorizontal: 10, fontSize: 12, minHeight: 38 },
    replySend: { width: 38, height: 38, borderRadius: 9, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
    loadingCard: { height: 300, borderRadius: 15, backgroundColor: C.card, padding: 20, borderWidth: 1, borderColor: C.border },
    loadingLine: { height: 11, width: '40%', borderRadius: 6, backgroundColor: C.secondary, marginBottom: 12 },
    loadingBlock: { height: 180, borderRadius: 10, backgroundColor: C.secondary, marginTop: 18 },
    discover: { paddingTop: 2 },
    sectionTitle: { color: C.foreground, fontSize: 18, fontWeight: '800' },
    sectionSubtitle: { color: C.mutedForeground, fontSize: 12, marginTop: 5, marginBottom: 17 },
    collectorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
    collectorCopy: { flex: 1, paddingLeft: 11 },
    collectorName: { color: C.foreground, fontSize: 13, fontWeight: '700' },
    collectorNote: { color: C.mutedForeground, fontSize: 11, marginTop: 5 },
    followButton: { borderWidth: 1, borderColor: C.primary, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 7 },
    followText: { color: C.primary, fontSize: 11, fontWeight: '700' },
    discoverCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, marginTop: 22, borderRadius: 13, backgroundColor: C.accent, borderWidth: 1, borderColor: C.borderAccent },
    discoverCardTitle: { color: C.foreground, fontWeight: '700', fontSize: 13 },
    discoverCardText: { color: C.mutedForeground, fontSize: 11, marginTop: 4 },
    messageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
    messageTop: { flexDirection: 'row', justifyContent: 'space-between' },
    messageTime: { color: C.mutedForeground, fontSize: 10 },
    messageText: { color: C.mutedForeground, fontSize: 12, marginTop: 5 },
    messageUnread: { color: C.foreground, fontWeight: '600' },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary, marginLeft: 8 },
    empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
    emptyTitle: { color: C.foreground, fontSize: 16, fontWeight: '700', marginTop: 12 },
    emptyText: { color: C.mutedForeground, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
    clearButton: { marginTop: 15, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 13 },
    clearText: { color: C.primary, fontSize: 11, fontWeight: '700' },
    notice: { position: 'absolute', left: 22, right: 22, minHeight: 42, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: C.background, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5 },
    noticeText: { color: C.foreground, fontSize: 12, fontWeight: '600' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 20 },
    modalDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: `${C.background}aa` },
    composerSheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 9, borderTopWidth: 1, borderColor: C.border },
    sheetHandle: { width: 37, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
    sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sheetTitle: { color: C.foreground, fontSize: 17, fontWeight: '800' },
    composerInput: { minHeight: 116, color: C.foreground, fontSize: 15, lineHeight: 22, textAlignVertical: 'top', paddingTop: 18 },
    attachment: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 11 },
    attachmentActive: { borderColor: C.primary, backgroundColor: C.accent },
    attachmentIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.secondary },
    attachmentTitle: { color: C.foreground, fontSize: 12, fontWeight: '700' },
    attachmentText: { color: C.mutedForeground, fontSize: 10, marginTop: 3 },
    sheetActions: { flexDirection: 'row', gap: 9, marginTop: 17 },
    cancelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.secondary, minHeight: 45 },
    cancelText: { color: C.foreground, fontSize: 13, fontWeight: '700' },
    publishButton: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: C.primary, minHeight: 45 },
    publishText: { color: C.primaryForeground, fontSize: 13, fontWeight: '800' },
    emptyIcon: { color: C.mutedForeground },
  });
}