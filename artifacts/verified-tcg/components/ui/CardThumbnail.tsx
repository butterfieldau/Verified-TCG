import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GradeBadge } from './Badge';
import type { Card, CollectionItem } from '@/types';

interface CardThumbnailProps {
  card: Card;
  grading?: CollectionItem['grading'];
  compact?: boolean;
  showPrice?: boolean;
}

function ShimmerSkeleton({
  gradientStart,
  gradientEnd,
}: {
  gradientStart: string;
  gradientEnd: string;
}) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  // Translate the shimmer band across the card
  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-160, 160],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Pulsing shimmer sweep */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        <LinearGradient
          colors={[
            'transparent',
            'rgba(255,255,255,0.28)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function CardThumbnail({
  card,
  grading,
  compact = false,
  showPrice = true,
}: CardThumbnailProps) {
  const width = compact ? 110 : 140;
  const height = compact ? 158 : 196;

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const displayPrice = grading
    ? (card.price.psa10 ?? card.price.raw)
    : card.price.raw;

  const showImage = !!card.imageUrl && !imageError;
  // Show shimmer while image is requested but not yet loaded or errored
  const showShimmer = showImage && !imageLoaded && !imageError;
  // Show the text fallback when there's no image or it errored
  const showFallback = !showImage || imageError || !imageLoaded;

  return (
    <View style={[styles.card, { width, height }]}>
      {/* Gradient background — always rendered as the base fallback layer */}
      <LinearGradient
        colors={[card.gradientStart, card.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Shimmer highlight accent over gradient */}
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.18)', 'transparent']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Animated shimmer skeleton — shown while image is in flight */}
      {showShimmer && (
        <ShimmerSkeleton
          gradientStart={card.gradientStart}
          gradientEnd={card.gradientEnd}
        />
      )}

      {/* Real card artwork */}
      {showImage && (
        <Image
          source={{ uri: card.imageUrl }}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          resizeMode="cover"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      )}

      {/* Text fallback — shown while loading or on error, hidden once image loads cleanly */}
      {showFallback && (
        <>
          {/* Card number */}
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>{card.number}</Text>
          </View>

          {/* Large card initial / first word */}
          <Text
            style={[styles.bigName, { fontSize: compact ? 22 : 28 }]}
            numberOfLines={1}
          >
            {card.name.split(' ')[0]}
          </Text>
        </>
      )}

      {/* Grade badge — always on top */}
      {grading && (
        <View style={styles.gradeBadge}>
          <GradeBadge
            grade={grading.grade}
            company={grading.company}
            size={compact ? 'sm' : 'md'}
          />
        </View>
      )}

      {/* Bottom info bar — always visible */}
      <View style={styles.bottom}>
        <Text style={styles.bottomName} numberOfLines={1}>
          {card.name}
        </Text>
        {showPrice && (
          <Text style={styles.bottomPrice}>
            ${displayPrice.toLocaleString('en-AU')} AUD
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  cardImage: {
    borderRadius: 12,
  },
  numberBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  numberText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  bigName: {
    position: 'absolute',
    top: 32,
    left: 10,
    fontFamily: 'Inter_700Bold',
    fontStyle: 'italic',
    color: 'rgba(255,255,255,0.85)',
  },
  gradeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  bottomName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  bottomPrice: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
    marginTop: 1,
  },
});
