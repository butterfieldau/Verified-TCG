/**
 * Post detail screen — shows the full post, like count, and a comment thread.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import {
  fetchPost,
  fetchComments,
  likePost,
  unlikePost,
  addComment,
  deleteComment,
  deletePost,
  formatRelativeTime,
  type FeedPost,
  type PostComment,
} from '@/services/communityApi';

const C = colors.dark;

const AVATAR_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#84CC16',
];
function avatarColor(initials: string): string {
  const code = (initials.charCodeAt(0) ?? 65) + (initials.charCodeAt(1) ?? 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!;
}

export default function PostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 20 : insets.bottom;

  const [post, setPost] = useState<FeedPost | null>(null);
  const [postLoading, setPostLoading] = useState(true);
  const [postError, setPostError] = useState<string | null>(null);

  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsPage, setCommentsPage] = useState(1);
  const [commentsHasMore, setCommentsHasMore] = useState(false);

  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load post
  useEffect(() => {
    if (!id) return;
    setPostLoading(true);
    fetchPost(id)
      .then(setPost)
      .catch(err => setPostError(err?.message ?? 'Failed to load post'))
      .finally(() => setPostLoading(false));
  }, [id]);

  // Load comments
  const loadComments = useCallback(async (page: number, replace: boolean) => {
    if (!id) return;
    setCommentsLoading(true);
    try {
      const data = await fetchComments(id, page);
      setComments(prev => replace ? data.comments : [...prev, ...data.comments]);
      setCommentsPage(data.page);
      setCommentsHasMore(data.hasMore);
    } catch {
      // fail silently — post is still visible
    } finally {
      setCommentsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) loadComments(1, true);
  }, [id, loadComments]);

  const handleLike = async () => {
    if (!post) return;
    setPost(p => p ? { ...p, isLiked: !p.isLiked, likeCount: p.isLiked ? p.likeCount - 1 : p.likeCount + 1 } : p);
    try {
      if (post.isLiked) await unlikePost(post.id);
      else await likePost(post.id);
    } catch {
      // revert
      setPost(p => p ? { ...p, isLiked: post.isLiked, likeCount: post.likeCount } : p);
    }
  };

  const handleDeletePost = () => {
    if (!post) return;
    Alert.alert('Delete Post', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePost(post.id);
            router.back();
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Failed to delete post');
          }
        },
      },
    ]);
  };

  const handleComment = async () => {
    if (!commentText.trim() || !id || submitting) return;
    setSubmitting(true);
    try {
      const comment = await addComment(id, commentText.trim());
      setComments(prev => [comment, ...prev]);
      setCommentText('');
      setPost(p => p ? { ...p, commentCount: p.commentCount + 1 } : p);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = (comment: PostComment) => {
    if (!id) return;
    Alert.alert('Delete Comment', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(id, comment.id);
            setComments(prev => prev.filter(c => c.id !== comment.id));
            setPost(p => p ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p);
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Failed to delete comment');
          }
        },
      },
    ]);
  };

  const renderHeader = () => {
    if (!post) return null;
    const color = avatarColor(post.author.initials);
    return (
      <View style={{ gap: 0 }}>
        {/* Post body */}
        <View style={[styles.postCard, { backgroundColor: C.card }]}>
          <Pressable
            style={styles.postHeader}
            onPress={() => router.push(`/collector/${post.author.username}` as any)}
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
              <Pressable onPress={handleDeletePost} hitSlop={8}>
                <Feather name="trash-2" size={15} color={C.mutedForeground} />
              </Pressable>
            )}
          </Pressable>

          <Text style={styles.postBody}>{post.body}</Text>

          {post.cardName && (
            <View style={[styles.cardRef, { backgroundColor: `${C.primary}18` }]}>
              <Feather name="credit-card" size={12} color={C.primary} />
              <Text style={[styles.cardRefText, { color: C.primary }]}>{post.cardName}</Text>
            </View>
          )}

          {/* Like */}
          <View style={styles.postActions}>
            <Pressable style={styles.actionChip} onPress={handleLike}>
              <Feather
                name="heart"
                size={18}
                color={post.isLiked ? '#EF4444' : C.mutedForeground}
              />
              <Text style={[styles.actionChipText, post.isLiked && { color: '#EF4444' }]}>
                {post.likeCount > 0 ? `${post.likeCount} ${post.likeCount === 1 ? 'like' : 'likes'}` : 'Like'}
              </Text>
            </Pressable>
            <View style={styles.actionChip}>
              <Feather name="message-circle" size={18} color={C.mutedForeground} />
              <Text style={styles.actionChipText}>
                {post.commentCount > 0 ? `${post.commentCount} ${post.commentCount === 1 ? 'comment' : 'comments'}` : 'Comments'}
              </Text>
            </View>
          </View>
        </View>

        {/* Comments header */}
        <Text style={styles.commentsHeader}>Comments</Text>
      </View>
    );
  };

  const renderComment = ({ item }: { item: PostComment }) => {
    const color = avatarColor(item.author.initials);
    return (
      <View style={[styles.commentCard, { backgroundColor: C.card }]}>
        <Pressable
          style={styles.commentHeader}
          onPress={() => router.push(`/collector/${item.author.username}` as any)}
        >
          <View style={[styles.commentAvatar, { backgroundColor: color }]}>
            <Text style={styles.commentAvatarText}>{item.author.initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.commentDisplayName}>{item.author.displayName}</Text>
              <Text style={styles.commentTime}>{formatRelativeTime(item.createdAt)}</Text>
            </View>
            <Text style={styles.commentUsername}>@{item.author.username}</Text>
          </View>
          {item.isOwn && (
            <Pressable onPress={() => handleDeleteComment(item)} hitSlop={8}>
              <Feather name="trash-2" size={13} color={C.mutedForeground} />
            </Pressable>
          )}
        </Pressable>
        <Text style={styles.commentBody}>{item.body}</Text>
      </View>
    );
  };

  if (postLoading) {
    return (
      <View style={[styles.screen, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      </View>
    );
  }

  if (postError || !post) {
    return (
      <View style={[styles.screen, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{postError ?? 'Post not found'}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: topPad }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={topPad}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Comments list with post as header */}
      <FlatList
        data={comments}
        keyExtractor={item => item.id}
        renderItem={renderComment}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}
        onEndReached={() => { if (commentsHasMore) loadComments(commentsPage + 1, false); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={commentsLoading ? () => (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : null}
        ListEmptyComponent={!commentsLoading ? () => (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={styles.noCommentsText}>No comments yet. Be the first!</Text>
          </View>
        ) : null}
      />

      {/* Comment input */}
      <View style={[styles.commentInputRow, { backgroundColor: C.card, paddingBottom: bottomPad + 8 }]}>
        <TextInput
          style={[styles.commentInput, { borderColor: C.border, color: C.foreground }]}
          placeholder="Add a comment…"
          placeholderTextColor={C.mutedForeground}
          value={commentText}
          onChangeText={setCommentText}
          maxLength={300}
          returnKeyType="send"
          onSubmitEditing={handleComment}
        />
        <Pressable
          style={[styles.sendBtn, { backgroundColor: C.primary, opacity: commentText.trim() ? 1 : 0.4 }]}
          onPress={handleComment}
          disabled={!commentText.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Feather name="send" size={16} color="#FFF" />
          }
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  postCard: { borderRadius: 14, padding: 14, gap: 10, marginBottom: 4 },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  postAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  postAvatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  postDisplayName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  postUsername: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  proBadge: { backgroundColor: '#D4AF3720', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  proBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#D4AF37', letterSpacing: 0.5 },
  postBody: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 22 },
  cardRef: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  cardRefText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  postActions: { flexDirection: 'row', gap: 20, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.border },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionChipText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  commentsHeader: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 0.5, textTransform: 'uppercase', paddingVertical: 12 },

  commentCard: { borderRadius: 12, padding: 12, gap: 6 },
  commentHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
  commentDisplayName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  commentUsername: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  commentTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  commentBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 18, marginLeft: 40 },

  noCommentsText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },

  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
