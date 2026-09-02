import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import {
  fetchFeed,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  addComment,
  searchCollectors,
  followCollector,
  unfollowCollector,
  formatRelativeTime,
  type FeedPost,
  type PublicCollector,
} from '@/services/communityApi';

const C = colors.dark;
const SAVED_POSTS_KEY = '@vtcg/community/saved-posts';

type TabView = 'feed' | 'discover' | 'messages';

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
  onSave: (postId: string) => void;
  onShare: (post: FeedPost) => void;
  isSaved: boolean;
  onProfile: (username: string) => void;
}

function PostCard({ post, onLike, onDelete, onComment, onSave, onShare, isSaved, onProfile }: PostCardProps) {
  const color = avatarColor(post.author.initials);
  return (
    <Animated.View entering={FadeInDown.duration(360)} style={[styles.postCard, { backgroundColor: C.card }]}>
      {/* Header */}
      <Pressable
        style={styles.postHeader}
        onPress={() => onProfile(post.author.username)}
        accessibilityRole="button"
        accessibilityLabel={`View ${post.author.displayName}'s profile`}
      >
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
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            accessibilityRole="button"
            accessibilityLabel="Delete post"
          >
            <Feather name="trash-2" size={15} color={C.mutedForeground} />
          </Pressable>
        )}
      </Pressable>

      {/* Body */}
      <Text style={styles.postBody}>{post.body}</Text>

      {/* Card reference */}
      {post.cardName && (
        <Pressable
          style={styles.cardReference}
          onPress={() => post.cardId ? router.push(`/card/${post.cardId}` as any) : undefined}
          accessibilityRole={post.cardId ? 'button' : undefined}
          accessibilityLabel={post.cardId ? `View ${post.cardName}` : post.cardName}
        >
          <LinearGradient
            colors={[color, '#171717']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardReferenceArt}
          >
            <Text style={styles.cardReferenceMark}>VERIFIED TCG</Text>
            <Feather name="credit-card" size={25} color="rgba(255,255,255,0.72)" />
          </LinearGradient>
          <View style={styles.cardReferenceCopy}>
            <Text style={styles.cardReferenceEyebrow}>CARD REFERENCE</Text>
            <Text style={styles.cardReferenceName} numberOfLines={3}>{post.cardName}</Text>
            <Text style={styles.cardReferenceMeta}>
              {post.cardId ? 'Open verified card details' : 'Community post'}
            </Text>
          </View>
          {post.cardId && <Feather name="arrow-up-right" size={16} color={C.mutedForeground} style={styles.cardReferenceArrow} />}
        </Pressable>
      )}

      {!post.cardName && (
        <View style={styles.noteReference}>
          <Feather name="edit-3" size={13} color={C.primary} />
          <Text style={styles.noteReferenceText}>Collector note</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.postActions}>
        <Pressable
          style={styles.action}
          onPress={() => onLike(post)}
          accessibilityRole="button"
          accessibilityLabel={post.isLiked
            ? `Unlike post. ${post.likeCount} like${post.likeCount !== 1 ? 's' : ''}`
            : `Like post. ${post.likeCount} like${post.likeCount !== 1 ? 's' : ''}`}
          accessibilityState={{ selected: post.isLiked }}
        >
          <Feather name="heart" size={17} color={post.isLiked ? C.primary : C.mutedForeground} fill={post.isLiked ? C.primary : 'transparent'} />
          <Text style={[styles.actionText, post.isLiked && { color: C.primary }]}>{post.likeCount || ''}</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => onComment(post)}
          accessibilityRole="button"
          accessibilityLabel={`Comment. ${post.commentCount} comment${post.commentCount !== 1 ? 's' : ''}`}
        >
          <Feather name="message-circle" size={17} color={C.mutedForeground} />
          <Text style={styles.actionText}>{post.commentCount || ''}</Text>
        </Pressable>
        <View style={styles.actionSpacer} />
        <Pressable
          style={styles.action}
          onPress={() => onSave(post.id)}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Remove saved post' : 'Save post'}
          accessibilityState={{ selected: isSaved }}
        >
          <Feather name="bookmark" size={17} color={isSaved ? C.primary : C.mutedForeground} fill={isSaved ? C.primary : 'transparent'} />
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() => onShare(post)}
          accessibilityRole="button"
          accessibilityLabel="Share post"
        >
          <Feather name="share-2" size={17} color={C.mutedForeground} />
        </Pressable>
      </View>
    </Animated.View>
    );
}

// ── Collector row ─────────────────────────────────────────────────────────────

function CollectorRow({
  collector,
  onPress,
  onFollow,
}: {
  collector: PublicCollector;
  onPress: () => void;
  onFollow: () => void;
}) {
  const color = avatarColor(collector.initials);
  return (
    <View style={[styles.collectorRow, { backgroundColor: C.card }]}>
      <Pressable
        style={styles.collectorProfileButton}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`View ${collector.displayName}'s profile`}
      >
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
      </Pressable>
      <Pressable
        onPress={onFollow}
        style={[styles.followButton, collector.isFollowing && styles.followButtonActive]}
        accessibilityRole="button"
        accessibilityLabel={collector.isFollowing ? `Unfollow ${collector.displayName}` : `Follow ${collector.displayName}`}
        accessibilityState={{ selected: !!collector.isFollowing }}
      >
        <Text style={[styles.followButtonText, collector.isFollowing && styles.followButtonTextActive]}>
          {collector.isFollowing ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </View>
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
        <Pressable
          style={styles.modalBg}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Post</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            >
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
              style={[styles.submitBtn, { backgroundColor: '#CC1826', opacity: text.trim() ? 1 : 0.4 }]}
              onPress={handleSubmit}
              disabled={!text.trim() || submitting}
              accessibilityRole="button"
              accessibilityLabel="Submit post"
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
  const [savedPostIds, setSavedPostIds] = useState<string[]>([]);
  const [commentingPost, setCommentingPost] = useState<FeedPost | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(SAVED_POSTS_KEY)
      .then(value => {
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every(id => typeof id === 'string')) {
          setSavedPostIds(parsed);
        }
      })
      .catch(() => undefined);
  }, []);

  const userInitials = useMemo(() => {
    const source = user?.displayName?.trim() || user?.username?.trim() || 'Collector';
    return source.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('');
  }, [user]);

  const announce = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(current => current === message ? '' : current), 2200);
  }, []);

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

  const handleSave = useCallback((postId: string) => {
    setSavedPostIds(current => {
      const isSaved = current.includes(postId);
      const next = isSaved ? current.filter(id => id !== postId) : [...current, postId];
      AsyncStorage.setItem(SAVED_POSTS_KEY, JSON.stringify(next))
        .then(() => announce(isSaved ? 'Removed from saved posts' : 'Post saved on this device'))
        .catch(() => announce('Could not save this post'));
      return next;
    });
  }, [announce]);

  const handleShare = useCallback(async (post: FeedPost) => {
    try {
      await Share.share({
        message: `${post.author.displayName} on Verified TCG\n\n${post.body}${post.cardName ? `\n\n${post.cardName}` : ''}`,
      });
    } catch {
      announce('Sharing is unavailable right now');
    }
  }, [announce]);

  const handleFollow = useCallback(async (collector: PublicCollector) => {
    const nextFollowing = !collector.isFollowing;
    setSearchResults(current => current.map(item =>
      item.id === collector.id ? { ...item, isFollowing: nextFollowing } : item
    ));
    try {
      if (nextFollowing) await followCollector(collector.username);
      else await unfollowCollector(collector.username);
      announce(nextFollowing ? `Following ${collector.displayName}` : `Unfollowed ${collector.displayName}`);
    } catch (error) {
      setSearchResults(current => current.map(item =>
        item.id === collector.id ? { ...item, isFollowing: !!collector.isFollowing } : item
      ));
      announce(error instanceof Error ? error.message : 'Could not update follow status');
    }
  }, [announce]);

  const handleCommentSubmit = useCallback(async () => {
    if (!commentingPost || !commentDraft.trim() || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      await addComment(commentingPost.id, commentDraft.trim());
      setFeed(current => current.map(post =>
        post.id === commentingPost.id
          ? { ...post, commentCount: post.commentCount + 1 }
          : post
      ));
      setCommentDraft('');
      setCommentingPost(null);
      announce('Comment added');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Could not add comment');
    } finally {
      setCommentSubmitting(false);
    }
  }, [announce, commentDraft, commentSubmitting, commentingPost]);

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
            style={[styles.signInBtn, { backgroundColor: '#CC1826' }]}
            onPress={() => router.push('/sign-in' as any)}
            accessibilityRole="button"
            accessibilityLabel="Sign In"
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
          <Pressable
            onPress={() => loadFeed(1, true)}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading feed"
          >
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
          <Pressable
            style={[styles.discoverBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]}
            onPress={() => setShowCreatePost(true)}
            accessibilityRole="button"
            accessibilityLabel="Create a community post"
          >
            <Text style={[styles.discoverBtnText, { color: C.foreground }]}>Share a Post</Text>
          </Pressable>
          <Pressable
            style={[styles.discoverBtn, { backgroundColor: C.primary }]}
            onPress={() => setActiveTab('discover')}
            accessibilityRole="button"
            accessibilityLabel="Find Collectors"
          >
            <Text style={styles.discoverBtnText}>Find Collectors</Text>
          </Pressable>
        </ScrollView>
      );
    }

    return (
      <FlashList
        data={feed}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={handleLike}
            onDelete={handleDelete}
            onComment={post => {
              setCommentingPost(post);
              setCommentDraft('');
            }}
            onSave={handleSave}
            onShare={handleShare}
            isSaved={savedPostIds.includes(item.id)}
            onProfile={username => router.push(`/collector/${username}` as any)}
          />
        )}
        ListHeaderComponent={() => (
          <Pressable
            style={styles.composerPrompt}
            onPress={() => setShowCreatePost(true)}
            accessibilityRole="button"
            accessibilityLabel="Share a community post"
          >
            <View style={[styles.postAvatar, { backgroundColor: avatarColor(userInitials) }]}>
              <Text style={styles.postAvatarText}>{userInitials}</Text>
            </View>
            <View style={styles.composerPromptCopy}>
              <Text style={styles.composerPromptTitle}>What are you displaying today?</Text>
              <Text style={styles.composerPromptText}>Share a card, a story, or a sharp eye.</Text>
            </View>
            <View style={styles.composerPromptIcon}>
              <Feather name="camera" size={18} color={C.primary} />
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
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
          <Pressable
            onPress={() => { setSearchQuery(''); setSearchResults([]); }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
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
              onFollow={() => handleFollow(item)}
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

  const renderInbox = () => (
    <View style={styles.inboxEmpty}>
      <View style={styles.inboxIcon}>
        <Feather name="message-circle" size={25} color={C.primary} />
      </View>
      <Text style={styles.emptyTitle}>Inbox is not connected yet</Text>
      <Text style={styles.emptyText}>
        Direct messages are not available in this release. Use post comments to keep collector conversations public and traceable.
      </Text>
      <Pressable
        onPress={() => setActiveTab('feed')}
        style={styles.outlineButton}
        accessibilityRole="button"
        accessibilityLabel="Return to community feed"
      >
        <Text style={styles.outlineButtonText}>Back to For You</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Animated.View entering={FadeIn.duration(320)} style={styles.brandHeader}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <View style={styles.brandMarkInner} />
          </View>
          <Text style={styles.brandName}>Verified TCG</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              router.push('/notifications' as any);
            }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Feather name="bell" size={19} color={C.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('messages')}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Open inbox"
          >
            <Feather name="message-circle" size={19} color={activeTab === 'messages' ? C.primary : C.mutedForeground} />
          </Pressable>
        </View>
      </Animated.View>

      <View style={styles.pageHeading}>
        <View>
          <Text style={styles.dateLabel}>
            {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
          </Text>
          <Text style={styles.pageTitle}>
            {activeTab === 'feed' ? 'Your community' : activeTab === 'discover' ? 'Find your people' : 'Inbox'}
          </Text>
        </View>
        <Pressable
          onPress={() => setActiveTab('discover')}
          style={styles.headingAction}
          accessibilityRole="button"
          accessibilityLabel="Search community"
        >
          <Feather name="search" size={20} color={C.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.tabRow}>
        {(['feed', 'discover', 'messages'] as TabView[]).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
            accessibilityRole="tab"
            accessibilityLabel={tab === 'feed' ? 'For you' : tab === 'discover' ? 'Discover' : 'Inbox'}
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'feed' ? 'For you' : tab === 'discover' ? 'Discover' : 'Inbox'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'feed' ? renderFeed() : activeTab === 'discover' ? renderDiscover() : renderInbox()}
      </View>

      <CreatePostModal
        visible={showCreatePost}
        onClose={() => setShowCreatePost(false)}
        onSubmit={handleCreatePost}
      />

      <Modal visible={!!commentingPost} animationType="slide" transparent presentationStyle="overFullScreen">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable style={styles.modalBg} onPress={() => setCommentingPost(null)} accessibilityLabel="Close comments" />
          <View style={styles.commentSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.sheetEyebrow}>CONVERSATION</Text>
                <Text style={styles.commentTitle}>Add a thoughtful note</Text>
              </View>
              <Pressable onPress={() => setCommentingPost(null)} accessibilityLabel="Close comment composer">
                <Feather name="x" size={21} color={C.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              value={commentDraft}
              onChangeText={setCommentDraft}
              autoFocus
              multiline
              maxLength={500}
              placeholder="Say something useful…"
              placeholderTextColor={C.mutedForeground}
              style={styles.commentInput}
            />
            <Pressable
              onPress={handleCommentSubmit}
              disabled={!commentDraft.trim() || commentSubmitting}
              style={[styles.commentSubmit, (!commentDraft.trim() || commentSubmitting) && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Add comment"
            >
              {commentSubmitting
                ? <ActivityIndicator size="small" color="#FFF" />
                : <>
                    <Text style={styles.commentSubmitText}>Add comment</Text>
                    <Feather name="send" size={14} color="#FFF" />
                  </>
              }
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {!!notice && (
        <Animated.View entering={FadeInDown.duration(220)} style={[styles.notice, { bottom: Platform.OS === 'web' ? 92 : insets.bottom + 74 }]}>
          <Feather name="check-circle" size={14} color={C.primary} />
          <Text style={styles.noticeText}>{notice}</Text>
        </Animated.View>
      )}
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
    minHeight: 44,
    justifyContent: 'center',
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
  collectorProfileButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
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
  submitBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, minWidth: 80, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  submitBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Premium community shell
  brandHeader: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  brandMarkInner: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.primary },
  brandName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: 0.4 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  pageHeading: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  dateLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1.15, marginBottom: 6 },
  pageTitle: { fontSize: 28, lineHeight: 32, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: -0.7 },
  headingAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  tabActive: { borderBottomColor: C.primary },
  tabTextActive: { color: C.foreground },

  // Feed
  composerPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    marginBottom: 2,
  },
  composerPromptCopy: { flex: 1, gap: 2 },
  composerPromptTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  composerPromptText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  composerPromptIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${C.primary}18`,
  },
  cardReference: {
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: 13,
    backgroundColor: C.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  cardReferenceArt: {
    width: 92,
    padding: 10,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardReferenceMark: { fontSize: 7, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.78)', letterSpacing: 0.65 },
  cardReferenceCopy: { flex: 1, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 11, gap: 4 },
  cardReferenceEyebrow: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 0.95 },
  cardReferenceName: { fontSize: 14, lineHeight: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  cardReferenceMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cardReferenceArrow: { alignSelf: 'center', marginRight: 11 },
  noteReference: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteReferenceText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, textTransform: 'uppercase', letterSpacing: 0.8 },
  action: { minWidth: 44, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  actionSpacer: { flex: 1 },

  // Discover
  followButton: {
    minHeight: 36,
    minWidth: 78,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
  },
  followButtonActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
  followButtonText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF' },
  followButtonTextActive: { color: C.foreground },

  // Inbox truth state
  inboxEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, gap: 12 },
  inboxIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${C.primary}15`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${C.primary}55`,
    marginBottom: 4,
  },
  outlineButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 19,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 5,
  },
  outlineButtonText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },

  // Comments and feedback
  commentSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 30,
    gap: 16,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  sheetEyebrow: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1 },
  commentTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground, marginTop: 3 },
  commentInput: {
    minHeight: 118,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.background,
    color: C.foreground,
    padding: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlignVertical: 'top',
  },
  commentSubmit: {
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  commentSubmitText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  buttonDisabled: { opacity: 0.45 },
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  noticeText: { flexShrink: 1, fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
