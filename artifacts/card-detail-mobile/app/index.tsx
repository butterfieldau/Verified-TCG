import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { useEffect, useMemo, useState } from 'react';

type Mode = 'Raw' | 'Graded' | 'POP';
type Section = 'Home' | 'Search' | 'Market' | 'Community' | 'Collection';
type Grader = 'PSA' | 'BGS' | 'CGC';

const FAVORITE_KEY = '@verified-tcg-card-detail/favorite';
const HOLDINGS_KEY = '@verified-tcg-card-detail/holdings';

const gradeOptions: Record<Grader, string[]> = {
  PSA: ['8', '9', '10'],
  BGS: ['9', '9.5', '10'],
  CGC: ['8', '9', '10'],
};

const prices: Record<string, number | null> = {
  Raw: 225.01,
  'PSA 8': 842,
  'PSA 9': 1480,
  'PSA 10': 3648.74,
  'BGS 9': 1120,
  'BGS 9.5': 2090,
  'BGS 10': 4180,
  'CGC 8': 760,
  'CGC 9': 1290,
  'CGC 10': 3020,
};

const population: Record<string, number> = {
  'PSA 8': 1842,
  'PSA 9': 2916,
  'PSA 10': 536,
  'BGS 9': 412,
  'BGS 9.5': 188,
  'BGS 10': 74,
  'CGC 8': 1036,
  'CGC 9': 1724,
  'CGC 10': 309,
};

const sales = [
  { title: 'Pikachu & Zekrom GX · PSA 10', price: '$3,599', date: '2 hours ago', seller: 'cardboardcastle' },
  { title: 'Pikachu & Zekrom GX · Raw', price: '$219', date: '5 hours ago', seller: 'tokyopulls' },
  { title: 'Pikachu & Zekrom GX · BGS 9.5', price: '$2,090', date: 'yesterday', seller: 'slabmarket' },
];

const chartPath = 'M0 94 L22 82 L44 88 L66 64 L88 70 L110 37 L132 48 L154 25 L176 33 L198 17 L220 38 L242 30 L264 52 L286 45 L308 59 L330 44 L360 50';

export default function CardDetailScreen() {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [mode, setMode] = useState<Mode>('Raw');
  const [grader, setGrader] = useState<Grader>('PSA');
  const [grade, setGrade] = useState('10');
  const [selectedGrades, setSelectedGrades] = useState<string[]>(['PSA 10']);
  const [rawQty, setRawQty] = useState(0);
  const [gradedQty, setGradedQty] = useState<Record<string, number>>({ 'PSA 10': 1, 'PSA 9': 0, 'BGS 9.5': 0 });
  const [favorite, setFavorite] = useState(false);
  const [range, setRange] = useState('3M');
  const [activeSection, setActiveSection] = useState<Section>('Collection');
  const [showInspect, setShowInspect] = useState(false);
  const [showSales, setShowSales] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom + 10;

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(FAVORITE_KEY), AsyncStorage.getItem(HOLDINGS_KEY)]).then(([savedFavorite, savedHoldings]) => {
      if (savedFavorite) setFavorite(savedFavorite === 'true');
      if (savedHoldings) {
        const parsed = JSON.parse(savedHoldings) as { rawQty?: number; gradedQty?: Record<string, number> };
        if (typeof parsed.rawQty === 'number') setRawQty(parsed.rawQty);
        if (parsed.gradedQty) setGradedQty(parsed.gradedQty);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(FAVORITE_KEY, String(favorite)).catch(() => undefined);
  }, [favorite]);

  useEffect(() => {
    AsyncStorage.setItem(HOLDINGS_KEY, JSON.stringify({ rawQty, gradedQty })).catch(() => undefined);
  }, [rawQty, gradedQty]);

  const selectedGrade = mode === 'Raw' ? 'Raw' : `${grader} ${grade}`;
  const currentPrice = prices[selectedGrade];
  const totalGraded = Object.values(gradedQty).reduce((sum, quantity) => sum + quantity, 0);
  const combinedValue = rawQty * (prices.Raw ?? 0) + Object.entries(gradedQty).reduce((sum, [key, quantity]) => sum + (prices[key] ?? 0) * quantity, 0);

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => current === message ? '' : current), 2200);
  };

  const pulse = async () => {
    if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const setQuantity = async (kind: 'raw' | string, delta: number) => {
    await pulse();
    if (kind === 'raw') setRawQty((current) => Math.max(0, current + delta));
    else setGradedQty((current) => ({ ...current, [kind]: Math.max(0, (current[kind] ?? 0) + delta) }));
  };

  const toggleGrade = (option: string) => {
    const key = `${grader} ${option}`;
    setGrade(option);
    setSelectedGrades((current) => current.includes(key)
      ? current.length === 1 ? current : current.filter((item) => item !== key)
      : [...current, key]);
  };

  const cycleGrader = () => {
    const next: Grader = grader === 'PSA' ? 'BGS' : grader === 'BGS' ? 'CGC' : 'PSA';
    setGrader(next);
    setGrade(gradeOptions[next][gradeOptions[next].length - 1]);
    setSelectedGrades([`${next} ${gradeOptions[next][gradeOptions[next].length - 1]}`]);
  };

  const shareCard = async () => {
    await Share.share({ message: 'Pikachu & Zekrom GX — verified market detail on Verified TCG' }).catch(() => showNotice('Sharing is unavailable right now'));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    setRefreshing(false);
    showNotice('Market data refreshed');
  };

  return (
    <View style={[styles.screen, { paddingTop: topInset }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => showNotice('Back to search')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Go back"><Feather name="arrow-left" size={17} color={C.foreground} /></Pressable>
        <View style={styles.headerActions}>
          <Pressable onPress={shareCard} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Share card"><Feather name="share-2" size={16} color={C.foreground} /></Pressable>
          <Pressable onPress={() => showNotice('More card actions')} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="More card actions"><Feather name="more-horizontal" size={17} color={C.foreground} /></Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 84 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} />}
      >
        <Pressable onPress={() => setShowInspect(true)} style={styles.hero} accessibilityRole="button" accessibilityLabel="Inspect card image">
          <Image source={require('@/assets/images/pikachu-zekrom.png')} style={styles.heroImage} resizeMode="cover" />
          <Text style={styles.heroCaption}>Tap image to inspect</Text>
        </Pressable>

        <View style={styles.identityCard}>
          <View style={styles.identityTop}>
            <View style={styles.identityCopy}>
              <Text style={styles.eyebrow}>POKÉMON · SUN & MOON PROMO</Text>
              <Text style={styles.cardTitle}>Pikachu &amp; Zekrom GX</Text>
              <Text style={styles.identityMeta}>Promo <Text style={styles.metaDot}>•</Text> SM168 <Text style={styles.metaDot}>•</Text> Holofoil</Text>
            </View>
            <Pressable onPress={async () => { await pulse(); setFavorite((current) => !current); showNotice(favorite ? 'Removed from favourites' : 'Added to favourites'); }} style={styles.favoriteButton} accessibilityRole="button" accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}><Feather name="heart" size={21} color={favorite ? C.primary : C.foreground} fill={favorite ? C.primary : 'transparent'} /></Pressable>
          </View>
          <View style={styles.priceRow}>
            <View><Text style={styles.priceLabel}>{selectedGrade} verified market value</Text><Text style={styles.priceValue}>{currentPrice == null ? 'Unavailable' : `$${currentPrice.toFixed(2)}`}</Text></View>
            <View><Text style={styles.priceChange}>▲ 10.47%</Text><Text style={styles.priceSource}>PriceCharting <Text style={styles.metaDot}>·</Text> AUD</Text></View>
          </View>
          <Pressable onPress={() => setShowSales(true)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} accessibilityRole="button"><Feather name="tag" size={15} color={C.primaryForeground} /><Text style={styles.primaryButtonText}>View sold listings</Text></Pressable>
        </View>

        <View style={styles.modeTabs} accessibilityRole="tablist">
          {(['Raw', 'Graded', 'POP'] as Mode[]).map((item) => <Pressable key={item} onPress={() => setMode(item)} style={[styles.modeTab, mode === item && styles.modeTabActive]} accessibilityRole="tab" accessibilityState={{ selected: mode === item }}><Text style={[styles.modeTabText, mode === item && styles.modeTabTextActive]}>{item}</Text></Pressable>)}
        </View>

        {mode === 'POP' ? <PopulationPanel styles={styles} C={C} /> : (
          <>
            <MarketPanel styles={styles} C={C} mode={mode} grader={grader} grade={grade} selectedGrades={selectedGrades} range={range} setRange={setRange} cycleGrader={cycleGrader} toggleGrade={toggleGrade} setGrade={setGrade} />
            <CollectionPanel styles={styles} C={C} rawQty={rawQty} gradedQty={gradedQty} totalGraded={totalGraded} combinedValue={combinedValue} setQuantity={setQuantity} onAddGrade={() => { setMode('Graded'); setGrader('BGS'); setGrade('9.5'); setSelectedGrades((current) => current.includes('BGS 9.5') ? current : [...current, 'BGS 9.5']); }} />
          </>
        )}

        <ListingsPreview styles={styles} onOpen={() => setShowSales(true)} />
      </ScrollView>

      <View style={[styles.bottomNav, { bottom: Platform.OS === 'web' ? 0 : 10 }]}>
        {(['Home', 'Search', 'Market', 'Community', 'Collection'] as Section[]).map((section) => <Pressable key={section} onPress={() => { setActiveSection(section); showNotice(section === 'Collection' ? 'Collection selected' : `${section} is available from the main app`); }} style={styles.bottomTab} accessibilityRole="button" accessibilityLabel={section}><Feather name={section === 'Home' ? 'home' : section === 'Search' ? 'search' : section === 'Market' ? 'bar-chart-2' : section === 'Community' ? 'users' : 'archive'} size={14} color={activeSection === section ? C.primary : C.mutedForeground} /><Text style={[styles.bottomLabel, activeSection === section && styles.bottomLabelActive]}>{section}</Text></Pressable>)}
      </View>

      {showInspect && <ImageInspect styles={styles} C={C} onClose={() => setShowInspect(false)} />}
      {showSales && <SalesSheet styles={styles} C={C} onClose={() => setShowSales(false)} />}
      {!!notice && <View style={[styles.notice, { bottom: bottomInset + 12 }]}><Feather name="check-circle" size={15} color={C.primary} /><Text style={styles.noticeText}>{notice}</Text></View>}
    </View>
  );
}

function MarketPanel({ styles, C, mode, grader, grade, selectedGrades, range, setRange, cycleGrader, toggleGrade, setGrade }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; mode: Mode; grader: Grader; grade: string; selectedGrades: string[]; range: string; setRange: (value: string) => void; cycleGrader: () => void; toggleGrade: (value: string) => void; setGrade: (value: string) => void }) {
  return <View style={styles.panel}><View style={styles.panelHeading}><View><Text style={styles.panelTitle}>{mode === 'Raw' ? 'Raw market' : 'Graded market'}</Text><Text style={styles.panelSubtitle}>Verified history</Text></View><View style={styles.verifiedLabel}><View style={styles.redDot} /><Text style={styles.verifiedLabelText}>Verified</Text></View></View>
    {mode === 'Graded' && <><View style={styles.selectRow}><View style={styles.selectHalf}><Text style={styles.fieldLabel}>Grading company</Text><Pressable onPress={cycleGrader} style={styles.selectControl}><Text style={styles.selectText}>{grader}</Text><Feather name="chevron-down" size={14} color={C.mutedForeground} /></Pressable></View><View style={styles.selectHalf}><Text style={styles.fieldLabel}>Primary grade</Text><Pressable onPress={() => setGrade(grade === gradeOptions[grader][0] ? gradeOptions[grader][gradeOptions[grader].length - 1] : gradeOptions[grader][0])} style={styles.selectControl}><Text style={styles.selectText}>{grader} {grade}</Text><Feather name="chevron-down" size={14} color={C.mutedForeground} /></Pressable></View></View><View style={styles.optionList}>{gradeOptions[grader].map((option) => <Pressable key={option} onPress={() => toggleGrade(option)} style={[styles.gradeOption, selectedGrades.includes(`${grader} ${option}`) && styles.gradeOptionActive]}><Text style={[styles.gradeOptionText, selectedGrades.includes(`${grader} ${option}`) && styles.gradeOptionTextActive]}>{grader} {option}</Text><Text style={styles.gradePop}>POP {population[`${grader} ${option}`]?.toLocaleString() ?? '—'}</Text></Pressable>)}</View></>}
    <View style={styles.availability}><View style={styles.redDot} /><Text style={styles.availabilityText}><Text style={styles.availabilityStrong}>{mode === 'Raw' ? 'Raw / ungraded' : `${selectedGrades.length} grades compared`}</Text> {mode === 'Raw' ? '· broad market estimate' : '· tap a grade to add or remove a line'}</Text></View>
    <Chart styles={styles} C={C} lines={mode === 'Raw' ? ['Raw'] : selectedGrades} />
    {mode === 'Graded' && <View style={styles.legend}>{selectedGrades.map((line, index) => <View key={line} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: index === 0 ? C.primary : C.accentForeground }]} /><Text style={styles.legendText}>{line}</Text></View>)}</View>}
    <View style={styles.chartLabels}><Text style={styles.chartLabel}>Jun</Text><Text style={styles.chartLabel}>Jul</Text><Text style={styles.chartLabel}>Aug</Text><Text style={styles.chartLabel}>Sep</Text></View>
    <View style={styles.rangeRow}>{['1M', '3M', '6M', '12M', 'MAX'].map((item) => <Pressable key={item} onPress={() => setRange(item)} style={[styles.rangeButton, range === item && styles.rangeButtonActive]}><Text style={[styles.rangeText, range === item && styles.rangeTextActive]}>{item}</Text></Pressable>)}</View>
  </View>;
}

function Chart({ styles, C, lines }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; lines: string[] }) {
  return <View style={styles.chartWrap}><Svg width="100%" height={120} viewBox="0 0 360 112" preserveAspectRatio="none"><Defs><LinearGradient id="priceArea" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={C.primary} stopOpacity=".22" /><Stop offset="1" stopColor={C.primary} stopOpacity="0" /></LinearGradient></Defs><Path d={`${chartPath} L360 112 L0 112Z`} fill="url(#priceArea)" />{lines.map((line, index) => <Path key={line} d={chartPath} fill="none" stroke={index === 0 ? C.primary : C.accentForeground} strokeWidth={index === 0 ? 2.7 : 2} strokeLinecap="round" opacity={index === 0 ? 1 : 0.86} transform={`translate(0 ${index * 5})`} />)}</Svg></View>;
}

function CollectionPanel({ styles, C, rawQty, gradedQty, totalGraded, combinedValue, setQuantity, onAddGrade }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; rawQty: number; gradedQty: Record<string, number>; totalGraded: number; combinedValue: number; setQuantity: (kind: string, delta: number) => void; onAddGrade: () => void }) {
  const holdings = [{ label: 'PSA 10', grader: 'PSA', pop: 536, value: 3648.74 }, { label: 'PSA 9', grader: 'PSA', pop: 2916, value: 1480 }, { label: 'BGS 9.5', grader: 'BGS', pop: 188, value: 2090 }];
  return <View style={styles.panel}><View style={styles.panelHeading}><View><Text style={styles.panelTitle}>Your collection</Text><Text style={styles.panelSubtitle}>Persisted on this device</Text></View><Text style={styles.totalValue}>${combinedValue.toFixed(2)}</Text></View>
    <View style={styles.collectionLine}><View style={styles.rawMark}><Text style={styles.rawMarkText}>RAW</Text></View><View style={styles.collectionCopy}><Text style={styles.collectionTitle}>Ungraded</Text><Text style={styles.collectionMeta}>Holofoil</Text></View><Quantity styles={styles} C={C} value={rawQty} onMinus={() => setQuantity('raw', -1)} onPlus={() => setQuantity('raw', 1)} /><Text style={styles.lineValue}>{rawQty ? '$225' : '—'}</Text></View>
    <View style={styles.slabs}><View style={styles.slabsTop}><View><Text style={styles.kicker}>GRADED COPIES</Text><Text style={styles.slabsTitle}>Your slabs</Text></View><Text style={styles.ownedTotal}>{totalGraded} owned</Text></View><View style={styles.slabsLabels}><Text style={styles.slabsLabel}>Grade · population</Text><Text style={styles.slabsLabel}>Owned</Text><Text style={styles.slabsLabel}>Value</Text></View>{holdings.map((holding) => <View key={holding.label} style={styles.holdingRow}><View style={styles.graderMark}><Text style={styles.graderText}>{holding.grader}</Text></View><View style={styles.holdingCopy}><Text style={styles.holdingTitle}>{holding.label}</Text><Text style={styles.holdingMeta}>Pop. {holding.pop.toLocaleString()} · exact match</Text></View><Quantity styles={styles} C={C} value={gradedQty[holding.label] ?? 0} small onMinus={() => setQuantity(holding.label, -1)} onPlus={() => setQuantity(holding.label, 1)} /><Text style={styles.holdingValue}>${holding.value.toLocaleString()}</Text></View>)}<View style={styles.slabsFooter}><Text style={styles.footerLabel}>Combined holding value</Text><Text style={styles.footerValue}>${combinedValue.toFixed(2)}</Text></View></View>
    <Pressable onPress={onAddGrade} style={styles.addGrade} accessibilityRole="button"><Text style={styles.addGradeText}>Choose another grade</Text><Feather name="arrow-right" size={14} color={C.primary} /></Pressable>
  </View>;
}

function Quantity({ styles, C, value, onMinus, onPlus, small = false }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; value: number; onMinus: () => void; onPlus: () => void; small?: boolean }) {
  return <View style={[styles.quantity, small && styles.quantitySmall]}><Pressable onPress={onMinus} style={[styles.quantityButton, small && styles.quantityButtonSmall]} accessibilityLabel="Decrease quantity"><Feather name="minus" size={small ? 11 : 12} color={C.primary} /></Pressable><Text style={styles.quantityValue}>{value}</Text><Pressable onPress={onPlus} style={[styles.quantityButton, small && styles.quantityButtonSmall]} accessibilityLabel="Increase quantity"><Feather name="plus" size={small ? 11 : 12} color={C.primary} /></Pressable></View>;
}

function PopulationPanel({ styles, C }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors> }) {
  const rows = [['Raw', '—', '$225'], ['PSA 8', '1,842', '$842'], ['PSA 9', '2,916', '$1,480'], ['PSA 10', '536', '$3,649'], ['BGS 10', '74', '$4,180']];
  return <View style={styles.panel}><View style={styles.panelHeading}><View><Text style={styles.panelTitle}>Population report</Text><Text style={styles.panelSubtitle}>All grades · updated 2d ago</Text></View><Feather name="bar-chart-2" size={17} color={C.primary} /></View><View style={styles.tableHeader}><Text style={styles.tableHeaderText}>GRADE</Text><Text style={styles.tableHeaderText}>POPULATION</Text><Text style={styles.tableHeaderText}>VALUE</Text></View>{rows.map(([label, pop, value]) => <View key={label} style={styles.tableRow}><Text style={styles.tableName}>{label}</Text><Text style={styles.tablePop}>{pop}</Text><Text style={styles.tableValue}>{value}</Text></View>)}<Text style={styles.popNote}>POP numbers show cards recorded by each grading company. Raw cards do not receive a population count.</Text></View>;
}

function ListingsPreview({ styles, onOpen }: { styles: ReturnType<typeof makeStyles>; onOpen: () => void }) {
  return <View style={styles.panel}><View style={styles.panelHeading}><View><Text style={styles.panelTitle}>Related listings</Text><Text style={styles.panelSubtitle}>Recent completed sales</Text></View><Pressable onPress={onOpen}><Text style={styles.viewAll}>View all</Text></Pressable></View>{sales.slice(0, 2).map((sale) => <Pressable key={sale.title} onPress={onOpen} style={styles.listingRow}><View style={styles.listingThumb}><View style={styles.thumbInner} /></View><View style={styles.listingCopy}><Text style={styles.listingTitle} numberOfLines={1}>{sale.title}</Text><Text style={styles.listingMeta}>{sale.seller} · {sale.date}</Text></View><Text style={styles.listingPrice}>{sale.price}</Text></Pressable>)}</View>;
}

function ImageInspect({ styles, C, onClose }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; onClose: () => void }) {
  return <View style={styles.overlay}><Pressable style={styles.overlayDismiss} onPress={onClose} /><View style={styles.inspectContent}><Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Close image inspector"><Feather name="x" size={18} color={C.foreground} /></Pressable><Image source={require('@/assets/images/pikachu-zekrom.png')} style={styles.inspectImage} resizeMode="contain" /><Text style={styles.inspectTitle}>Pikachu &amp; Zekrom GX</Text><Text style={styles.inspectSubtitle}>SM168 · Holofoil · tap outside to close</Text></View></View>;
}

function SalesSheet({ styles, C, onClose }: { styles: ReturnType<typeof makeStyles>; C: ReturnType<typeof useColors>; onClose: () => void }) {
  return <View style={styles.overlay}><Pressable style={styles.overlayDismiss} onPress={onClose} /><View style={styles.salesSheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeading}><View><Text style={styles.sheetTitle}>Sold listings</Text><Text style={styles.sheetSubtitle}>Pikachu &amp; Zekrom GX · recent sales</Text></View><Pressable onPress={onClose} accessibilityLabel="Close sold listings"><Feather name="x" size={19} color={C.mutedForeground} /></Pressable></View>{sales.map((sale) => <View key={sale.title} style={styles.saleRow}><View style={styles.saleIcon}><Feather name="tag" size={14} color={C.primary} /></View><View style={styles.saleCopy}><Text style={styles.saleTitle}>{sale.title}</Text><Text style={styles.saleMeta}>{sale.seller} · {sale.date}</Text></View><Text style={styles.salePrice}>{sale.price}</Text></View>)}<Pressable onPress={() => { onClose(); }} style={styles.sheetButton}><Text style={styles.sheetButtonText}>Done</Text></Pressable></View></View>;
}

function makeStyles(C: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: C.background },
    header: { minHeight: 58, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerActions: { flexDirection: 'row', gap: 8 },
    iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceStrong },
    scrollContent: { paddingHorizontal: 12 },
    hero: { height: 260, alignItems: 'center', justifyContent: 'center', position: 'relative' },
    heroImage: { width: 155, height: 216, borderRadius: 12, borderWidth: 4, borderColor: C.textSecondary, transform: [{ rotate: '2deg' }] },
    heroCaption: { position: 'absolute', bottom: 4, color: C.mutedForeground, fontSize: 10, letterSpacing: 0.3 },
    identityCard: { padding: 15, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: C.card, marginBottom: 12 },
    identityTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    identityCopy: { flex: 1 },
    eyebrow: { color: C.mutedForeground, fontSize: 10, letterSpacing: 0.5 },
    cardTitle: { color: C.foreground, fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 },
    identityMeta: { color: C.textSecondary, fontSize: 11, marginTop: 5 },
    metaDot: { color: C.primary },
    favoriteButton: { padding: 4, marginTop: 17 },
    priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18 },
    priceLabel: { color: C.mutedForeground, fontSize: 10 },
    priceValue: { color: C.foreground, fontSize: 29, lineHeight: 34, fontWeight: '800', letterSpacing: -0.9 },
    priceChange: { color: C.primary, fontSize: 12, fontWeight: '800', textAlign: 'right' },
    priceSource: { color: C.mutedForeground, fontSize: 9, marginTop: 4, textAlign: 'right' },
    primaryButton: { minHeight: 46, borderRadius: 9, marginTop: 15, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    primaryButtonText: { color: C.primaryForeground, fontSize: 13, fontWeight: '800' },
    pressed: { opacity: 0.75 },
    modeTabs: { flexDirection: 'row', gap: 4, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.card },
    modeTab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    modeTabActive: { backgroundColor: C.foreground },
    modeTabText: { color: C.mutedForeground, fontSize: 12, fontWeight: '700' },
    modeTabTextActive: { color: C.background },
    panel: { padding: 15, marginBottom: 12, borderWidth: 1, borderColor: C.border, borderRadius: 13, backgroundColor: C.card },
    panelHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 13 },
    panelTitle: { color: C.foreground, fontSize: 14, fontWeight: '800' },
    panelSubtitle: { color: C.mutedForeground, fontSize: 10, marginTop: 3 },
    verifiedLabel: { flexDirection: 'row', gap: 5, alignItems: 'center' },
    verifiedLabelText: { color: C.mutedForeground, fontSize: 10 },
    redDot: { width: 7, height: 7, borderRadius: 5, backgroundColor: C.primary },
    selectRow: { flexDirection: 'row', gap: 8 },
    selectHalf: { flex: 1 },
    fieldLabel: { color: C.mutedForeground, fontSize: 10, marginBottom: 5 },
    selectControl: { height: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: C.secondary },
    selectText: { color: C.foreground, fontSize: 11, fontWeight: '700' },
    optionList: { flexDirection: 'row', gap: 6, paddingTop: 9 },
    gradeOption: { flex: 1, paddingVertical: 7, paddingHorizontal: 8, borderWidth: 1, borderColor: C.border, borderRadius: 7, backgroundColor: C.surfaceStrong },
    gradeOptionActive: { borderColor: C.primary, backgroundColor: C.accent },
    gradeOptionText: { color: C.textSecondary, fontSize: 10, fontWeight: '700' },
    gradeOptionTextActive: { color: C.foreground },
    gradePop: { color: C.mutedForeground, fontSize: 8, marginTop: 3 },
    availability: { paddingTop: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderTopColor: C.border },
    availabilityText: { color: C.mutedForeground, fontSize: 10, flex: 1 },
    availabilityStrong: { color: C.foreground, fontWeight: '700' },
    chartWrap: { height: 122, marginTop: 8, backgroundColor: C.surfaceStrong, borderBottomWidth: 1, borderBottomColor: C.border },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 7, height: 7, borderRadius: 4 },
    legendText: { color: C.mutedForeground, fontSize: 9 },
    chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
    chartLabel: { color: C.mutedForeground, fontSize: 9 },
    rangeRow: { flexDirection: 'row', gap: 5, marginTop: 12 },
    rangeButton: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 6 },
    rangeButtonActive: { backgroundColor: C.foreground },
    rangeText: { color: C.mutedForeground, fontSize: 9, fontWeight: '700' },
    rangeTextActive: { color: C.background },
    totalValue: { color: C.primary, fontSize: 11, fontWeight: '800' },
    collectionLine: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
    rawMark: { width: 38, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: C.secondary },
    rawMarkText: { color: C.textSecondary, fontSize: 9, fontWeight: '800' },
    collectionCopy: { flex: 1 },
    collectionTitle: { color: C.foreground, fontSize: 11, fontWeight: '700' },
    collectionMeta: { color: C.mutedForeground, fontSize: 9, marginTop: 3 },
    quantity: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    quantitySmall: { gap: 4 },
    quantityButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 13 },
    quantityButtonSmall: { width: 20, height: 20 },
    quantityValue: { color: C.foreground, minWidth: 10, textAlign: 'center', fontSize: 11, fontWeight: '700' },
    lineValue: { minWidth: 48, color: C.foreground, textAlign: 'right', fontSize: 13, fontWeight: '800' },
    slabs: { padding: 13, marginTop: 8, borderWidth: 1, borderColor: C.borderAccent, borderRadius: 10, backgroundColor: C.surfaceStrong },
    slabsTop: { flexDirection: 'row', justifyContent: 'space-between' },
    kicker: { color: C.mutedForeground, fontSize: 8, letterSpacing: 1 },
    slabsTitle: { color: C.foreground, fontSize: 18, fontWeight: '800', marginTop: 3 },
    ownedTotal: { color: C.primary, fontSize: 10, fontWeight: '800' },
    slabsLabels: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, paddingLeft: 47 },
    slabsLabel: { color: C.mutedForeground, fontSize: 8, letterSpacing: 0.3 },
    holdingRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderTopColor: C.border },
    graderMark: { width: 38, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: C.primary },
    graderText: { color: C.primaryForeground, fontSize: 9, fontWeight: '800' },
    holdingCopy: { flex: 1 },
    holdingTitle: { color: C.foreground, fontSize: 10, fontWeight: '700' },
    holdingMeta: { color: C.mutedForeground, fontSize: 8, marginTop: 2 },
    holdingValue: { minWidth: 54, color: C.primary, textAlign: 'right', fontSize: 12, fontWeight: '800' },
    slabsFooter: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, marginTop: 4, borderTopWidth: 1, borderTopColor: C.border },
    footerLabel: { color: C.mutedForeground, fontSize: 9 },
    footerValue: { color: C.primary, fontSize: 14, fontWeight: '800' },
    addGrade: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, paddingTop: 11 },
    addGradeText: { color: C.primary, fontSize: 10, fontWeight: '800' },
    tableHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 7 },
    tableHeaderText: { color: C.mutedForeground, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
    tableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, borderTopWidth: 1, borderTopColor: C.border },
    tableName: { flex: 1, color: C.textSecondary, fontSize: 11, fontWeight: '700' },
    tablePop: { width: 85, color: C.primary, textAlign: 'right', fontSize: 13, fontWeight: '800' },
    tableValue: { width: 70, color: C.primary, textAlign: 'right', fontSize: 13, fontWeight: '800' },
    popNote: { color: C.mutedForeground, fontSize: 9, lineHeight: 13, marginTop: 12 },
    viewAll: { color: C.primary, fontSize: 10, fontWeight: '800' },
    listingRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border },
    listingThumb: { width: 42, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.textSecondary, borderRadius: 5, backgroundColor: C.primary },
    thumbInner: { width: 27, height: 37, borderRadius: 2, borderWidth: 1, borderColor: C.textSecondary, backgroundColor: C.accent },
    listingCopy: { flex: 1 },
    listingTitle: { color: C.foreground, fontSize: 10, fontWeight: '700' },
    listingMeta: { color: C.mutedForeground, fontSize: 9, marginTop: 4 },
    listingPrice: { color: C.primary, fontSize: 15, fontWeight: '800' },
    bottomNav: { position: 'absolute', left: 12, right: 12, minHeight: 57, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-around', borderWidth: 1, borderColor: C.border, borderRadius: 17, backgroundColor: C.card },
    bottomTab: { minWidth: 46, alignItems: 'center', justifyContent: 'center', gap: 3 },
    bottomLabel: { color: C.mutedForeground, fontSize: 8 },
    bottomLabelActive: { color: C.primary },
    notice: { position: 'absolute', left: 22, right: 22, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.card, elevation: 5 },
    noticeText: { color: C.foreground, fontSize: 11, fontWeight: '700' },
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: 'flex-end' },
    overlayDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: `${C.background}dd` },
    inspectContent: { alignItems: 'center', padding: 22, paddingBottom: 34 },
    closeButton: { alignSelf: 'flex-end', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 18, backgroundColor: C.card, marginBottom: 15 },
    inspectImage: { width: 290, height: 400, borderRadius: 15 },
    inspectTitle: { color: C.foreground, fontSize: 17, fontWeight: '800', marginTop: 17 },
    inspectSubtitle: { color: C.mutedForeground, fontSize: 10, marginTop: 5 },
    salesSheet: { padding: 18, paddingBottom: 24, borderTopWidth: 1, borderColor: C.border, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: C.card },
    sheetHandle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 2, backgroundColor: C.border, marginBottom: 17 },
    sheetHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 13 },
    sheetTitle: { color: C.foreground, fontSize: 18, fontWeight: '800' },
    sheetSubtitle: { color: C.mutedForeground, fontSize: 10, marginTop: 4 },
    saleRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border },
    saleIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.accent },
    saleCopy: { flex: 1 },
    saleTitle: { color: C.foreground, fontSize: 10, fontWeight: '700' },
    saleMeta: { color: C.mutedForeground, fontSize: 9, marginTop: 4 },
    salePrice: { color: C.primary, fontSize: 15, fontWeight: '800' },
    sheetButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: C.primary, marginTop: 13 },
    sheetButtonText: { color: C.primaryForeground, fontSize: 13, fontWeight: '800' },
  });
}