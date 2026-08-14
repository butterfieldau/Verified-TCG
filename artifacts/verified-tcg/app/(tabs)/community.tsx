import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
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
import { useApp } from '@/context/AppContext';
import {
  fetchFeed,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  searchCollectors,
  formatRelativeTime,
  type FeedPost,
  type PublicCollector,
} from '@/services/communityApi';

const C = colors.dark;

type TabView = 'feed' | 'discover';

// ── Avatar color from initials ────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#84CC16',
];
function avatarColor(initials: string): string {
  const code = (initials.charCodeAt(0) ?? 65) + (initials.charCodeAt(1) ?? 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!;
}

// ── Post card ─────────────────────────────────────────────────────────────────

interface PostCardProps {
  post: FeedPost;
  onLike: (post: FeedPost) => void;
  onDelete: (postId: string) => void;
  onComment: (post: FeedPost) => void;
  onProfile: (username: string) => void;
}

function PostCard({ post, onLike, onDelete, onComment, onProfile }: PostCardProps) {
  const color = avatarColor(post.author.initials);
  return (
    <View style={[styles.postCard, { backgroundColor: C.card }]}>
      {/* Header */}
      <Pressable style={styles.postHeader} onPress={() => onProfile(post.author.username)}>
        <View style={[styles.postAvatar, { backgroundColor: color }]}>
          <Text style={styles.postAvatarText}>{post.author.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.postDisplayName}>{post.author.displayName}</Text>
            {post.author.subscriptionTier === 'pro' && (
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
            )}
          </View>
          <Text style={styles.postUsername}>@{post.author.username} · {formatRelativeTime(post.createdAt)}</Text>
        </View>
        {post.isOwn && (
          <Pressable
            onPress={() => {
              Alert.alert('Delete Post', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => onDelete(post.id),
                },
              ]);
            }}
            hitSlop={8}
          >
            <Feather name="trash-2" size={15} color={C.mutedForeground} />
          </Pressable>
        )}
      </Pressable>

      {/* Body */}
      <Text style={styles.postBody}>{post.body}</Text>

      {/* Card reference */}
      {post.cardName && (
        <View style={[styles.cardRef, { backgroundColor: `${C.primary}18` }]}>
          <Feather name="credit-card" size={12} color={C.primary} />
          <Text style={[styles.cardRefText, { color: C.primary }]}>{post.cardName}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.postActions}>
        <Pressable style={styles.actionChip} onPress={() => onLike(post)}>
          <Feather
            name="heart"
            size={16}
            color={post.isLiked ? '#EF4444' : C.mutedForeground}
            style={post.isLiked ? { opacity: 1 } : { opacity: 0.7 }}
          />
          <Text style={[styles.actionChipText, post.isLiked && { color: '#EF4444' }]}>
            {post.likeCount > 0 ? post.likeCount : ''}
          </Text>
        </Pressable>
        <Pressable style={styles.actionChip} onPress={() => onComment(post)}>
          <Feather name="message-circle" size={16} color={C.mutedForeground} style={{ opacity: 0.7 }} />
          <Text style={styles.actionChipText}>
            {post.commentCount > 0 ? post.commentCount : ''}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Collector row ─────────────────────────────────────────────────────────────

function CollectorRow({ collector, onPress }: { collector: PublicCollector; onPress: () => void }) {
  const color = avatarColor(collector.initials);
  return (
    <Pressable style={[styles.collectorRow, { backgroundColor: C.card }]} onPress={onPress}>
      <View style={[styles.collectorAvatar, { backgroundColor: color }]}>
        <Text style={styles.collectorAvatarText}>{collector.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.collectorName}>{collector.displayName}</Text>
          {collector.subscriptionTier === 'pro' && (
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>PRO</Text>
            </View>
          )}
        </View>
        <Text style={styles.collectorUsername}>@{collector.username}</Text>
        {collector.bio ? (
          <Text style={styles.collectorBio} numberOfLines={1}>{collector.bio}</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={C.mutedForeground} />
    </Pressable>
  );
}

// ── Create Post Modal ─────────────────────────────────────────────────────────

interface CreatePostModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (body: string) => Promise<void>;
}

function CreatePostModal({ visible, onClose, onSubmit }: CreatePostModalProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim());
      setText('');
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <Pressable style={styles.modalBg} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Post</Text>
            <Pressable onPress={onClose}>
              <Feather name="x" size={22} color={C.mutedForeground} />
            </Pressable>
          </View>
          <TextInput
            style={[styles.modalInput, { borderColor: C.border, color: C.foreground }]}
            placeholder="What's on your mind? Share a card find, trade tip, or milestone…"
            placeholderTextColor={C.mutedForeground}
            multiline
            numberOfLines={4}
            maxLength={500}
            value={text}
            onChangeText={setText}
            autoFocus
          />
          <View style={styles.modalFooter}>
            <Text style={styles.charCount}>{text.length}/500</Text>
            <Pressable
              style={[styles.submitBtn, { backgroundColor: C.primary, opacity: text.trim() ? 1 : 0.4 }]}
              onPress={handleSubmit}
              disabled={!text.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={styles.submitBtnText}>Post</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [activeTab, setActiveTab] = useState<TabView>('feed');
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicCollector[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showCreatePost, setShowCreatePost] = useState(false);

  // ── Feed loading ───────────────────────────────────────────────────────────

  const loadFeed = useCallback(async (page: number, replace: boolean) => {
    if (!isAuthenticated) return;
    try {
      if (replace) setFeedLoading(true);
      setFeedError(null);
      const data = await fetchFeed(page);
      setFeed(prev => replace ? data.feed : [...prev, ...data.feed]);
      setFeedPage(data.page);
      setFeedHasMore(data.hasMore);
    } catch (err: any) {
      setFeedError(err?.message ?? 'Failed to load feed');
    } finally {
      setFeedLoading(false);
      setFeedRefreshing(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeTab === 'feed') loadFeed(1, true);
  }, [activeTab, loadFeed]);

  const onRefresh = useCallback(() => {
    setFeedRefreshing(true);
    loadFeed(1, true);
  }, [loadFeed]);

  const onLoadMore = useCallback(() => {
    if (feedHasMore && !feedLoading) loadFeed(feedPage + 1, false);
  }, [feedHasMore, feedLoading, feedPage, loadFeed]);

  // ── Search ─────────────────────────────────────────────────────────────────

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!q.trim() || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchCollectors(q.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
  }, []);

  // ── Like ───────────────────────────────────────────────────────────────────

  const handleLike = useCallback(async (post: FeedPost) => {
    // Optimistic update
    setFeed(prev => prev.map(p =>
      p.id === post.id
        ? { ...p, isLiked: !p.isLiked, likeCount: p.isLiked ? p.likeCount - 1 : p.likeCount + 1 }
        : p
    ));
    try {
      if (post.isLiked) {
        await unlikePost(post.id);
      } else {
        await likePost(post.id);
      }
    } catch {
      // Revert on error
      setFeed(prev => prev.map(p =>
        p.id === post.id
          ? { ...p, isLiked: post.isLiked, likeCount: post.likeCount }
          : p
      ));
    }
  }, []);

  // ── Delete post ────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (postId: string) => {
    try {
      await deletePost(postId);
      setFeed(prev => prev.filter(p => p.id !== postId));
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to delete post');
    }
  }, []);

  // ── Create post ────────────────────────────────────────────────────────────

  const handleCreatePost = useCallback(async (body: string) => {
    const post = await createPost({ body });
    setFeed(prev => [post, ...prev]);
  }, []);

  // ── Not signed in ──────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <View style={[styles.screen, { paddingTop: topPad }]}>
        <View style={styles.unauthContainer}>
          <Feather name="users" size={44} color={C.mutedForeground} />
          <Text style={styles.unauthTitle}>Community</Text>
          <Text style={styles.unauthText}>
            Sign in to follow collectors, share posts, and see what's happening in the community.
          </Text>
          <Pressable
            style={[styles.signInBtn, { backgroundColor: C.primary }]}
            onPress={() => router.push('/sign-in' as any)}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Feed render ────────────────────────────────────────────────────────────

  const renderFeed = () => {
    if (feedLoading && feed.length === 0) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      );
    }

    if (feedError) {
      return (
        <View style={styles.center}>
          <Feather name="wifi-off" size={32} color={C.mutedForeground} />
          <Text style={styles.emptyText}>{feedError}</Text>
          <Pressable onPress={() => loadFeed(1, true)} style={styles.retryBtn}>
            <Text style={[styles.retryBtnText, { color: C.primary }]}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (feed.length === 0) {
      return (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={feedRefreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          <Feather name="rss" size={36} color={C.mutedForeground} />
          <Text style={styles.emptyTitle}>Your feed is empty</Text>
          <Text style={styles.emptyText}>
            Follow some collectors to see their activity here. Search for collectors to get started.
          </Text>
          <Pressable style={[styles.discoverBtn, { backgroundColor: C.primary }]} onPress={() => setActiveTab('discover')}>
            <Text style={styles.discoverBtnText}>Find Collectors</Text>
          </Pressable>
        </ScrollView>
      );
    }

    return (
      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={handleLike}
            onDelete={handleDelete}
            onComment={post => router.push(`/post/${post.id}` as any)}
            onProfile={username => router.push(`/collector/${username}` as any)}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 10 }}
        refreshControl={<RefreshControl refreshing={feedRefreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={feedHasMore ? () => (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : null}
      />
    );
  };

  // ── Discover render ────────────────────────────────────────────────────────

  const renderDiscover = () => (
    <View style={{ flex: 1 }}>
      <View style={[styles.searchBar, { backgroundColor: C.card, borderColor: C.border }]}>
        <Feather name="search" size={16} color={C.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: C.foreground }]}
          placeholder="Search collectors…"
          placeholderTextColor={C.mutedForeground}
          value={searchQuery}
          onChangeText={handleSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchLoading && <ActivityIndicator size="small" color={C.mutedForeground} />}
        {searchQuery.length > 0 && !searchLoading && (
          <Pressable onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
            <Feather name="x" size={16} color={C.mutedForeground} />
          </Pressable>
        )}
      </View>

      {searchResults.length > 0 ? (
        <FlatList
          data={searchResults}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <CollectorRow
              collector={item}
              onPress={() => router.push(`/collector/${item.username}` as any)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 8, paddingTop: 4 }}
        />
      ) : searchQuery.length >= 2 && !searchLoading ? (
        <View style={styles.center}>
          <Feather name="search" size={32} color={C.mutedForeground} />
          <Text style={styles.emptyText}>No collectors found for "{searchQuery}"</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Feather name="users" size={36} color={C.mutedForeground} />
          <Text style={styles.emptyTitle}>Find Collectors</Text>
          <Text style={styles.emptyText}>
            Search by username or display name to find collectors in the community.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Community</Text>
        {activeTab === 'feed' && (
          <Pressable
            style={[styles.createBtn, { backgroundColor: C.primary }]}
            onPress={() => setShowCreatePost(true)}
          >
            <Feather name="edit-3" size={14} color="#FFF" />
            <Text style={styles.createBtnText}>Post</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { borderBottomColor: C.border }]}>
        {(['feed', 'discover'] as TabView[]).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: C.primary }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && { color: C.foreground }]}>
              {tab === 'feed' ? 'Feed' : 'Discover'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {activeTab === 'feed' ? renderFeed() : renderDiscover()}
      </View>

      {/* Create Post Modal */}
      <CreatePostModal
        visible={showCreatePost}
        onClose={() => setShowCreatePost(false)}
        onSubmit={handleCreatePost}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  createBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: 16,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },

  // Post card
  postCard: { borderRadius: 14, padding: 14, gap: 10 },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  postAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postAvatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  postDisplayName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  postUsername: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  proBadge: {
    backgroundColor: '#D4AF3720',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  proBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#D4AF37', letterSpacing: 0.5 },
  postBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 20 },
  cardRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  cardRefText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  postActions: { flexDirection: 'row', gap: 16, paddingTop: 2 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 36 },
  actionChipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Collector row
  collectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
  },
  collectorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectorAvatarText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  collectorUsername: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  collectorBio: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },

  // Empty / error states
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  discoverBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  discoverBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  // Not authenticated
  unauthContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  unauthTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  unauthText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20 },
  signInBtn: { marginTop: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 28 },
  signInBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Create post modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlignVertical: 'top',
  },
  modalFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  charCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  submitBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, minWidth: 80, alignItems: 'center' },
  submitBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
