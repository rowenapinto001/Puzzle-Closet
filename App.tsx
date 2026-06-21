import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

const STORAGE_KEY = 'puzzle-closet-save-v1';
const MAX_LIVES = 5;
const LIFE_REFRESH_MS = 5 * 60 * 60 * 1000;
const CONTINUE_COST = 25;
const LEVEL_COUNT = 100;

const palette = {
  cream: '#FFF8E8',
  sky: '#BFE9FF',
  skyDeep: '#80CFFF',
  pink: '#FFC6D9',
  pinkDeep: '#FF86AD',
  peach: '#FFD8B8',
  mint: '#BCEFD8',
  mintDeep: '#6DD9A7',
  lavender: '#DCCBFF',
  lilac: '#B8A5FF',
  yellow: '#FFE98A',
  coral: '#FF9E96',
  cocoa: '#6C4F5F',
  white: '#FFFFFF',
  softShadow: '#EAB7C7',
};

const clothingTypes = ['shirt', 'skirt', 'dress', 'jacket', 'bag', 'shoes', 'scarf', 'hat'] as const;
const itemColors = [
  '#FF8FB3',
  '#A98BFF',
  '#6DD9A7',
  '#FFB76E',
  '#7BDFF2',
  '#F7A8FF',
  '#FFE66D',
  '#FF9E96',
] as const;
const patternNames = ['candy lane', 'star stitch', 'ribbon road', 'confetti trail', 'heart path'] as const;
const levelOneGoal = {
  blue: 3,
  orange: 1,
  red: 1,
  white: 2,
  black: 1,
} as const;
const levelOneYarnColors = {
  blue: '#36AEEB',
  orange: '#FFB15F',
  red: '#FF6F91',
  white: '#FFFFFF',
  black: '#2F2A38',
} as const;

type Screen = 'home' | 'puzzle' | 'boutique' | 'levels' | 'settings';
type ClothingType = (typeof clothingTypes)[number];
type YarnColor = keyof typeof levelOneGoal;
type CatDirection = 'up' | 'down' | 'left' | 'right';

type FashionItem = {
  id: string;
  level: number;
  type: ClothingType;
  color: string;
  pattern: string;
  price: number;
  sold: boolean;
};

type GameState = {
  highestLevel: number;
  currentLevel: number;
  lives: number;
  coins: number;
  gems: number;
  clothes: FashionItem[];
  lastLifeRefresh: number;
};

type PuzzleData = {
  size: number;
  target: number[];
  initial: number[];
  moves: number;
  colors: string[];
};

type LevelOneCat = {
  id: string;
  color: YarnColor;
  direction: CatDirection;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

const levelOneCats: LevelOneCat[] = [
  { id: 'blue-1', color: 'blue', direction: 'right', start: { x: 20, y: 104 }, end: { x: 142, y: 104 } },
  { id: 'blue-2', color: 'blue', direction: 'down', start: { x: 178, y: 20 }, end: { x: 178, y: 132 } },
  { id: 'blue-3', color: 'blue', direction: 'left', start: { x: 294, y: 194 }, end: { x: 206, y: 194 } },
  { id: 'orange-1', color: 'orange', direction: 'right', start: { x: 24, y: 222 }, end: { x: 138, y: 222 } },
  { id: 'red-1', color: 'red', direction: 'left', start: { x: 298, y: 92 }, end: { x: 214, y: 92 } },
  { id: 'white-1', color: 'white', direction: 'down', start: { x: 102, y: 26 }, end: { x: 102, y: 150 } },
  { id: 'white-2', color: 'white', direction: 'up', start: { x: 238, y: 340 }, end: { x: 238, y: 226 } },
  { id: 'black-1', color: 'black', direction: 'up', start: { x: 66, y: 342 }, end: { x: 66, y: 248 } },
];

const defaultGameState: GameState = {
  highestLevel: 1,
  currentLevel: 1,
  lives: MAX_LIVES,
  coins: 0,
  gems: 230,
  clothes: [],
  lastLifeRefresh: Date.now(),
};

function clampLevel(level: number) {
  return Math.max(1, Math.min(LEVEL_COUNT, level));
}

function createFashionItem(level: number): FashionItem {
  const type = clothingTypes[(level - 1) % clothingTypes.length];
  const color = itemColors[(level * 3) % itemColors.length];
  const pattern = patternNames[(level * 5 + 2) % patternNames.length];

  return {
    id: `level-${level}-${type}`,
    level,
    type,
    color,
    pattern,
    price: 18 + ((level * 7) % 28),
    sold: false,
  };
}

function createPuzzle(level: number): PuzzleData {
  const size = level < 12 ? 3 : 4;
  const tileCount = size * size;
  const target = Array.from({ length: tileCount }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    return (row + col + level) % 4;
  });
  const offsets = Array.from({ length: tileCount }, (_, index) => ((level + index * 2) % 3) + 1);
  const initial = target.map((direction, index) => (direction + offsets[index]) % 4);
  const minimumMoves = initial.reduce((total, direction, index) => {
    return total + ((target[index] - direction + 4) % 4);
  }, 0);

  return {
    size,
    target,
    initial,
    moves: minimumMoves + 4 + (level % 4),
    colors: Array.from({ length: tileCount }, (_, index) => itemColors[(level + index) % itemColors.length]),
  };
}

function applyLifeRefresh(state: GameState): GameState {
  const now = Date.now();
  const lastRefresh = state.lastLifeRefresh || now;

  if (state.lives < MAX_LIVES && now - lastRefresh >= LIFE_REFRESH_MS) {
    return {
      ...state,
      lives: MAX_LIVES,
      lastLifeRefresh: now,
    };
  }

  return state;
}

function normaliseSave(value: Partial<GameState> | null): GameState {
  if (!value) {
    return defaultGameState;
  }

  return applyLifeRefresh({
    highestLevel: clampLevel(value.highestLevel ?? 1),
    currentLevel: clampLevel(value.currentLevel ?? value.highestLevel ?? 1),
    lives: Math.max(0, Math.min(MAX_LIVES, value.lives ?? MAX_LIVES)),
    coins: Math.max(0, value.coins ?? 0),
    gems: Math.max(0, value.gems ?? 230),
    clothes: Array.isArray(value.clothes) ? value.clothes : [],
    lastLifeRefresh: value.lastLifeRefresh ?? Date.now(),
  });
}

function formatRefreshTime(lastLifeRefresh: number, lives: number) {
  if (lives >= MAX_LIVES) {
    return 'Full';
  }

  const remainingMs = Math.max(0, LIFE_REFRESH_MS - (Date.now() - lastLifeRefresh));
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  return `${hours}h ${minutes}m`;
}

function formatRefreshClock(lastLifeRefresh: number, lives: number) {
  const remainingMs = lives >= MAX_LIVES ? LIFE_REFRESH_MS : Math.max(0, LIFE_REFRESH_MS - (Date.now() - lastLifeRefresh));
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function useBounce(delay = 0, distance = 8) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [delay, distance, value]);

  return value.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -distance],
  });
}

function Pill({ label, value, tone = 'pink' }: { label: string; value: string; tone?: 'pink' | 'mint' | 'yellow' }) {
  const backgroundColor = tone === 'mint' ? palette.mint : tone === 'yellow' ? palette.yellow : palette.pink;

  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue}>{value}</Text>
    </View>
  );
}

function CuteButton({
  label,
  onPress,
  tone = 'pink',
  wide = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'pink' | 'mint' | 'lavender' | 'yellow' | 'peach';
  wide?: boolean;
}) {
  const backgroundColor =
    tone === 'mint'
      ? palette.mintDeep
      : tone === 'lavender'
        ? palette.lilac
        : tone === 'yellow'
          ? palette.yellow
          : tone === 'peach'
            ? palette.peach
            : palette.pinkDeep;

  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[styles.cuteButton, { backgroundColor }, wide && styles.wideButton]}>
      <Text style={styles.cuteButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function StringLights() {
  return (
    <View style={styles.lightString}>
      {Array.from({ length: 13 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.lightBulb,
            { backgroundColor: index % 3 === 0 ? palette.yellow : index % 3 === 1 ? palette.pink : palette.mint },
          ]}
        />
      ))}
    </View>
  );
}

function FloatingShape({
  style,
  color,
  label,
  delay,
}: {
  style: object;
  color: string;
  label?: string;
  delay: number;
}) {
  const translateY = useBounce(delay, 10);

  return (
    <Animated.View style={[styles.floatShape, { backgroundColor: color, transform: [{ translateY }] }, style]}>
      {label ? <Text style={styles.floatShapeLabel}>{label}</Text> : null}
    </Animated.View>
  );
}

function SparkleField({ count = 18, dark = false }: { count?: number; dark?: boolean }) {
  return (
    <View pointerEvents="none" style={styles.sparkleField}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.sparkleDot,
            {
              left: `${(index * 29) % 94}%`,
              top: `${(index * 41) % 92}%`,
              backgroundColor: index % 3 === 0 ? palette.yellow : index % 3 === 1 ? palette.pink : palette.sky,
              opacity: dark ? 0.85 : 0.72,
              transform: [{ scale: 0.7 + (index % 4) * 0.22 }],
            },
          ]}
        />
      ))}
    </View>
  );
}

function CollageSticker({
  label,
  color,
  style,
}: {
  label: string;
  color: string;
  style?: object;
}) {
  return (
    <View style={[styles.collageSticker, { backgroundColor: color }, style]}>
      <View style={styles.collageStickerShine} />
      <Text style={styles.collageStickerText}>{label}</Text>
    </View>
  );
}

function GameLogo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.logoWrap, compact && styles.logoWrapCompact]}>
      <View style={styles.logoBow}>
        <View style={styles.logoBowWing} />
        <View style={styles.logoBowKnot} />
        <View style={styles.logoBowWing} />
      </View>
      <View style={styles.logoStitchRow}>
        {Array.from({ length: 13 }).map((_, index) => (
          <View key={index} style={styles.logoStitch} />
        ))}
      </View>
      <Text style={[styles.logoText, compact && styles.logoTextCompact]}>PUZZLE</Text>
      <View style={styles.logoSecondLine}>
        <View style={styles.logoHanger}>
          <View style={styles.logoHook} />
          <View style={styles.logoHangerLine} />
        </View>
        <Text style={[styles.logoText, styles.logoClosetText, compact && styles.logoTextCompact]}>CLOSET</Text>
      </View>
      <View style={styles.logoDecorRow}>
        <Text style={styles.logoDecor}>heart</Text>
        <Text style={styles.logoDecor}>bow</Text>
        <Text style={styles.logoDecor}>button</Text>
        <Text style={styles.logoDecor}>sparkle</Text>
      </View>
      <View style={styles.logoStitchRow}>
        {Array.from({ length: 13 }).map((_, index) => (
          <View key={index} style={styles.logoStitch} />
        ))}
      </View>
    </View>
  );
}

function LoadingScreen() {
  const progress = useRef(new Animated.Value(0)).current;
  const sparkleY = useBounce(0, 8);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0.12,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    ).start();
  }, [progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '96%'],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.loadingScene}>
        <SparkleField count={34} />
        <View style={styles.loadingBackdropGlow} />
        <StringLights />
        <CollageSticker label="button" color={palette.lavender} style={styles.loadingStickerButton} />
        <CollageSticker label="candy" color={palette.pinkDeep} style={styles.loadingStickerCandy} />
        <CollageSticker label="yarn" color="#F0549B" style={styles.loadingStickerYarn} />
        <CollageSticker label="shirt" color={palette.yellow} style={styles.loadingStickerShirt} />
        <CollageSticker label="skirt" color={palette.pink} style={styles.loadingStickerSkirt} />
        <CollageSticker label="hanger" color={palette.peach} style={styles.loadingStickerHanger} />
        <CollageSticker label="bow" color={palette.skyDeep} style={styles.loadingBow} />
        <View style={styles.loadingCharactersTop}>
          <MiniCharacter type="robotCat" />
          <MiniCharacter type="redBoy" />
          <MiniCharacter type="monster" />
        </View>
        <Animated.View style={[styles.loadingCenterSparkle, { transform: [{ translateY: sparkleY }] }]}>
          <Text style={styles.loadingCenterSparkleText}>magic stitch glow</Text>
        </Animated.View>
        <GameLogo />
        <View style={styles.loadingCharactersBottom}>
          <MiniCharacter type="goofyCat" />
          <MiniCharacter type="duo" />
          <MiniCharacter type="doll" />
          <MiniCharacter type="car" />
        </View>
        <View style={styles.loadingDecorCloud}>
          {['dress', 'shirt', 'skirt', 'hanger', 'puzzle', 'candy', 'buttons', 'stars', 'hearts', 'bags'].map((label, index) => (
            <View key={label} style={[styles.tinyDecorPill, { backgroundColor: itemColors[index % itemColors.length] }]}>
              <Text style={styles.tinyDecorText}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.loadingBarFrame}>
          <Animated.View style={[styles.loadingBarFill, { width }]} />
          <View style={styles.loadingBarShine} />
        </View>
        <Text style={styles.loadingWaitText}>Loading... Please wait ❤️</Text>
      </View>
    </SafeAreaView>
  );
}

function TopResource({
  label,
  value,
  detail,
  color,
  onPress,
}: {
  label: string;
  value: string;
  detail?: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.resourceCard}>
      <View style={[styles.resourceIcon, { backgroundColor: color }]}>
        <Text style={styles.resourceIconText}>{label.charAt(0)}</Text>
      </View>
      <View style={styles.resourceCopy}>
        <Text style={styles.resourceLabel}>{label}</Text>
        <Text style={styles.resourceValue}>{value}</Text>
        {detail ? <Text style={styles.resourceDetail}>{detail}</Text> : null}
      </View>
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.addButton}>
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function ResourceStack({
  game,
  refresh,
  onOpen,
}: {
  game: GameState;
  refresh: string;
  onOpen: (screen: Screen) => void;
}) {
  return (
    <View style={styles.resourceStack}>
      <TopResource
        label="Lives"
        value={`${game.lives} FULL`}
        detail={`Resets in: ${refresh}`}
        color={palette.pinkDeep}
        onPress={() => onOpen('settings')}
      />
      <TopResource label="Coins" value={formatNumber(game.coins)} color={palette.yellow} onPress={() => onOpen('boutique')} />
      <TopResource label="Gems" value={formatNumber(game.gems)} color={palette.lilac} onPress={() => onOpen('settings')} />
    </View>
  );
}

function PlayerProfile({ level }: { level: number }) {
  return (
    <View style={styles.playerProfile}>
      <View style={styles.avatar}>
        <View style={styles.avatarHair} />
        <View style={styles.avatarEyeRow}>
          <View style={styles.avatarEye} />
          <View style={styles.avatarEye} />
        </View>
        <View style={styles.avatarSmile} />
      </View>
      <View>
        <Text style={styles.playerName}>Player</Text>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>Lv {level}</Text>
        </View>
      </View>
    </View>
  );
}

function HomeAction({ label, title, onPress }: { label: string; title: string; onPress: () => void }) {
  const translateY = useBounce(title.length * 80, 3);

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={styles.homeActionButton}>
        <Text style={styles.homeActionIcon}>{label}</Text>
        <Text style={styles.homeActionText}>{title}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function HomeActionRail({ onOpen }: { onOpen: (screen: Screen) => void }) {
  return (
    <View style={styles.homeActionRail}>
      <HomeAction label="gift" title="Daily" onPress={() => onOpen('settings')} />
      <HomeAction label="spin" title="Spin" onPress={() => onOpen('levels')} />
      <HomeAction label="tasks" title="Tasks" onPress={() => onOpen('settings')} />
    </View>
  );
}

function FerrisWheel() {
  return (
    <View style={styles.ferrisWheel}>
      <View style={styles.ferrisRing}>
        {Array.from({ length: 8 }).map((_, index) => (
          <View key={index} style={[styles.ferrisSpoke, { transform: [{ rotate: `${index * 22.5}deg` }] }]} />
        ))}
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[
              styles.ferrisCabin,
              {
                backgroundColor: [palette.pink, palette.yellow, palette.mint, palette.lavender][index],
                transform: [{ rotate: `${index * 90}deg` }, { translateY: -50 }],
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.ferrisLegs}>
        <View style={styles.ferrisLegLeft} />
        <View style={styles.ferrisLegRight} />
      </View>
    </View>
  );
}

function HotAirBalloon({ color, style, delay }: { color: string; style: object; delay: number }) {
  const translateY = useBounce(delay, 11);

  return (
    <Animated.View style={[styles.balloonWrap, style, { transform: [{ translateY }] }]}>
      <View style={[styles.balloonTop, { backgroundColor: color }]}>
        <View style={styles.balloonStripe} />
      </View>
      <View style={styles.balloonBasket} />
    </Animated.View>
  );
}

function Firework({ style, delay }: { style: object; delay: number }) {
  const scale = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(scale, {
          toValue: 1.12,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.75,
          duration: 850,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [delay, scale]);

  return (
    <Animated.View style={[styles.firework, style, { transform: [{ scale }] }]}>
      {Array.from({ length: 8 }).map((_, index) => (
        <View key={index} style={[styles.fireworkRay, { transform: [{ rotate: `${index * 22.5}deg` }] }]} />
      ))}
    </Animated.View>
  );
}

function Fountain() {
  const water = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(water, {
          toValue: 1,
          duration: 1250,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(water, {
          toValue: 0,
          duration: 1250,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [water]);

  const translateY = water.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <View style={styles.fountainWrap}>
      <View style={styles.fountainGlow} />
      <Animated.View style={[styles.fountainSpray, { transform: [{ translateY }] }]}>
        <View style={styles.fountainDrop} />
        <View style={[styles.fountainDrop, styles.fountainDropSmall]} />
        <View style={[styles.fountainDrop, styles.fountainDropTiny]} />
      </Animated.View>
      <View style={styles.fountainBowl}>
        <View style={styles.fountainWater} />
      </View>
      <View style={styles.fountainBase} />
    </View>
  );
}

function MiniCharacter({
  type,
  small = false,
}: {
  type: 'robotCat' | 'redBoy' | 'monster' | 'goofyCat' | 'duo' | 'doll' | 'car' | 'bugs';
  small?: boolean;
}) {
  if (type === 'car') {
    return (
      <View style={[styles.carBody, small && styles.smallToken]}>
        <View style={styles.carWindow} />
        <View style={styles.carWheelRow}>
          <View style={styles.carWheel} />
          <View style={styles.carWheel} />
        </View>
      </View>
    );
  }

  if (type === 'duo') {
    return (
      <View style={[styles.duoToken, small && styles.smallToken]}>
        <View style={[styles.duoFriend, { backgroundColor: palette.yellow }]} />
        <View style={[styles.duoFriend, { backgroundColor: palette.mint }]} />
      </View>
    );
  }

  if (type === 'bugs') {
    return (
      <View style={[styles.bugRow, small && styles.smallToken]}>
        {[palette.cocoa, palette.pinkDeep, palette.lilac].map((color, index) => (
          <View key={index} style={[styles.tinyBug, { backgroundColor: color }]} />
        ))}
      </View>
    );
  }

  const config = {
    robotCat: { body: palette.skyDeep, accent: palette.white, label: 'bot cat' },
    redBoy: { body: palette.coral, accent: palette.yellow, label: 'red pal' },
    monster: { body: palette.mintDeep, accent: palette.lavender, label: 'monster' },
    goofyCat: { body: palette.peach, accent: palette.pink, label: 'goofy cat' },
    doll: { body: palette.pink, accent: palette.lilac, label: 'doll' },
  }[type];

  return (
    <View style={[styles.characterToken, small && styles.smallToken, { backgroundColor: config.body }]}>
      <View style={[styles.characterEarLeft, { backgroundColor: config.accent }]} />
      <View style={[styles.characterEarRight, { backgroundColor: config.accent }]} />
      <View style={styles.characterEyeRow}>
        <View style={styles.characterEye} />
        <View style={styles.characterEye} />
      </View>
      <View style={styles.characterSmileLine} />
      <Text style={styles.characterLabel}>{config.label}</Text>
    </View>
  );
}

function CharacterParade() {
  return (
    <View style={styles.characterParade}>
      <MiniCharacter type="robotCat" small />
      <MiniCharacter type="redBoy" small />
      <MiniCharacter type="monster" small />
      <MiniCharacter type="goofyCat" small />
      <MiniCharacter type="bugs" small />
      <MiniCharacter type="duo" small />
      <MiniCharacter type="doll" small />
      <MiniCharacter type="car" small />
    </View>
  );
}

function HomeHouse({
  title,
  action,
  detail,
  roofColor,
  bodyColor,
  onPress,
  fashion,
}: {
  title: string;
  action: string;
  detail: string;
  roofColor: string;
  bodyColor: string;
  onPress: () => void;
  fashion?: boolean;
}) {
  const translateY = useBounce(fashion ? 500 : 120, 5);

  return (
    <Animated.View style={[styles.bigHouseWrap, { transform: [{ translateY }] }]}>
      <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.bigHouseTap}>
        <View style={[styles.bigHouseRoof, { borderBottomColor: roofColor }]} />
        <View style={[styles.bigHouseBody, { backgroundColor: bodyColor }]}>
          <View style={styles.houseGlowLights}>
            {Array.from({ length: 5 }).map((_, index) => (
              <View key={index} style={[styles.houseMiniLight, { backgroundColor: itemColors[index % itemColors.length] }]} />
            ))}
          </View>
          <View style={styles.bigWindowRow}>
            <View style={styles.bigWindow}>
              <Text style={styles.windowIcon}>{fashion ? 'dress' : 'puzzle'}</Text>
            </View>
            <View style={styles.bigWindow}>
              <Text style={styles.windowIcon}>{fashion ? 'bag' : 'piece'}</Text>
            </View>
          </View>
          <Text style={styles.bigHouseTitle}>{title}</Text>
          <Text style={styles.bigHouseDetail}>{detail}</Text>
          <View style={[styles.housePlayButton, { backgroundColor: roofColor }]}>
            <Text style={styles.housePlayText}>{action}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function BottomNav({ onOpen }: { onOpen: (screen: Screen) => void }) {
  return (
    <View style={styles.bottomNav}>
      <TouchableOpacity onPress={() => onOpen('levels')} style={styles.navButton}>
        <Text style={styles.navIcon}>PZ</Text>
        <Text style={styles.navText}>Levels</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onOpen('boutique')} style={styles.navButton}>
        <Text style={styles.navIcon}>DR</Text>
        <Text style={styles.navText}>Closet</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onOpen('puzzle')} style={styles.playNavButton}>
        <Text style={styles.playNavIcon}>PLAY</Text>
        <Text style={styles.playNavText}>Play</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onOpen('boutique')} style={styles.navButton}>
        <Text style={styles.navIcon}>SH</Text>
        <Text style={styles.navText}>Shop</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onOpen('settings')} style={styles.navButton}>
        <Text style={styles.navIcon}>SET</Text>
        <Text style={styles.navText}>Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

function HouseCard({
  title,
  subtitle,
  accent,
  onPress,
  side,
}: {
  title: string;
  subtitle: string;
  accent: string;
  onPress: () => void;
  side: 'left' | 'right';
}) {
  const translateY = useBounce(side === 'left' ? 200 : 600, 7);

  return (
    <Animated.View style={[styles.houseFloat, { transform: [{ translateY }] }]}>
      <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.houseTapArea}>
        <View style={[styles.houseRoof, { borderBottomColor: accent }]} />
        <View style={[styles.houseBody, { backgroundColor: side === 'left' ? '#FFE1EC' : '#D8F7EA' }]}>
          <View style={styles.houseWindowRow}>
            <View style={[styles.houseWindow, { backgroundColor: palette.sky }]} />
            <View style={[styles.houseWindow, { backgroundColor: palette.yellow }]} />
          </View>
          <View style={[styles.houseDoor, { backgroundColor: accent }]} />
          <Text style={styles.houseTitle}>{title}</Text>
          <Text style={styles.houseSubtitle}>{subtitle}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function FashionIcon({ item, size = 62 }: { item: FashionItem; size?: number }) {
  const commonStyle = {
    backgroundColor: item.color,
    borderColor: palette.white,
  };

  if (item.type === 'shirt') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.sleeve, commonStyle, { left: size * 0.04, top: size * 0.16 }]} />
        <View style={[styles.sleeve, commonStyle, { right: size * 0.04, top: size * 0.16 }]} />
        <View style={[styles.shirtBody, commonStyle, { width: size * 0.5, height: size * 0.58 }]} />
      </View>
    );
  }

  if (item.type === 'skirt') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.skirtTop, commonStyle, { width: size * 0.45 }]} />
        <View style={[styles.skirtBody, commonStyle, { borderLeftWidth: size * 0.18, borderRightWidth: size * 0.18, borderBottomWidth: size * 0.5 }]} />
      </View>
    );
  }

  if (item.type === 'dress') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.dressTop, commonStyle]} />
        <View style={[styles.dressBottom, { borderBottomColor: item.color }]} />
      </View>
    );
  }

  if (item.type === 'jacket') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.jacketPanel, commonStyle, { left: size * 0.17 }]} />
        <View style={[styles.jacketPanel, commonStyle, { right: size * 0.17 }]} />
      </View>
    );
  }

  if (item.type === 'bag') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.bagHandle, { borderColor: item.color }]} />
        <View style={[styles.bagBody, commonStyle]} />
      </View>
    );
  }

  if (item.type === 'shoes') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.shoe, commonStyle, { left: size * 0.1 }]} />
        <View style={[styles.shoe, commonStyle, { right: size * 0.1 }]} />
      </View>
    );
  }

  if (item.type === 'scarf') {
    return (
      <View style={[styles.iconBox, { width: size, height: size }]}>
        <View style={[styles.scarfLoop, { borderColor: item.color }]} />
        <View style={[styles.scarfTail, commonStyle, { left: size * 0.28 }]} />
        <View style={[styles.scarfTail, commonStyle, { right: size * 0.28, height: size * 0.34 }]} />
      </View>
    );
  }

  return (
    <View style={[styles.iconBox, { width: size, height: size }]}>
      <View style={[styles.hatTop, commonStyle]} />
      <View style={[styles.hatBrim, commonStyle]} />
    </View>
  );
}

function Customer({ request }: { request: FashionItem | null }) {
  const translateX = useRef(new Animated.Value(42)).current;

  useEffect(() => {
    translateX.setValue(42);
    Animated.spring(translateX, {
      toValue: 0,
      friction: 7,
      tension: 45,
      useNativeDriver: true,
    }).start();
  }, [request?.id, translateX]);

  return (
    <Animated.View style={[styles.customerCard, { transform: [{ translateX }] }]}>
      <View style={styles.customerFace}>
        <View style={styles.customerHair} />
        <View style={styles.customerEyeRow}>
          <View style={styles.customerEye} />
          <View style={styles.customerEye} />
        </View>
        <View style={styles.customerSmile} />
      </View>
      <View style={styles.speechBubble}>
        <Text style={styles.speechTitle}>Boutique visitor</Text>
        <Text style={styles.speechText}>
          {request ? `May I try the ${request.pattern} ${request.type}?` : 'I will come back when new fashion arrives.'}
        </Text>
      </View>
    </Animated.View>
  );
}

function Header({
  title,
  onBack,
  game,
}: {
  title: string;
  onBack: () => void;
  game: GameState;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity activeOpacity={0.75} onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerStats}>
        <Text style={styles.headerStatText}>Lives {game.lives}</Text>
        <Text style={styles.headerStatText}>Coins {game.coins}</Text>
      </View>
    </View>
  );
}

function HomeScreen({
  game,
  onOpen,
}: {
  game: GameState;
  onOpen: (screen: Screen) => void;
}) {
  const refresh = formatRefreshClock(game.lastLifeRefresh, game.lives);
  const itemsCreated = game.clothes.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.homeRoot}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.homeScroll}>
          <StringLights />
          <View style={styles.homeSky}>
            <SparkleField count={42} dark />
            <View style={styles.nightGlowTop} />
            <View style={styles.distantVillage}>
              {Array.from({ length: 10 }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.distantHouse,
                    {
                      height: 24 + (index % 4) * 8,
                      backgroundColor: index % 2 === 0 ? '#5D4AA0' : '#7D4FA7',
                    },
                  ]}
                >
                  <View style={styles.distantWindow} />
                </View>
              ))}
            </View>
            <FerrisWheel />
            <HotAirBalloon color={palette.pink} delay={0} style={styles.homeBalloonOne} />
            <HotAirBalloon color={palette.lavender} delay={700} style={styles.homeBalloonTwo} />
            <Firework delay={150} style={styles.fireworkOne} />
            <Firework delay={900} style={styles.fireworkTwo} />
            <FloatingShape color={palette.yellow} delay={300} label="star" style={styles.homeStarOne} />
            <FloatingShape color={palette.pink} delay={650} label="heart" style={styles.homeHeartOne} />
            <FloatingShape color={palette.mint} delay={950} label="bow" style={styles.homeBowOne} />

            <View style={styles.topHud}>
              <PlayerProfile level={game.highestLevel} />
              <ResourceStack game={game} refresh={refresh} onOpen={onOpen} />
            </View>

            <View style={styles.homeBoardFrame}>
              <HomeActionRail onOpen={onOpen} />
              <View style={styles.fairyLightBridge}>
                {Array.from({ length: 13 }).map((_, index) => (
                  <View key={index} style={[styles.bridgeLight, { backgroundColor: itemColors[index % itemColors.length] }]} />
                ))}
              </View>
              <GameLogo compact />
              <View style={styles.funFairSign}>
                <Text style={styles.funFairText}>Fun Fair</Text>
                <Text style={styles.funFairHeart}>heart</Text>
              </View>
              <View style={styles.fairgroundScene}>
              <View style={styles.pathway} />
              <View style={styles.flowerPatchLeft}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <View key={index} style={[styles.flowerDot, { backgroundColor: itemColors[index % itemColors.length] }]} />
                ))}
              </View>
              <View style={styles.flowerPatchRight}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <View key={index} style={[styles.flowerDot, { backgroundColor: itemColors[(index + 3) % itemColors.length] }]} />
                ))}
              </View>

              <View style={styles.mainHousesRow}>
                <HomeHouse
                  title="PUZZLE HOUSE"
                  action="PLAY PUZZLES"
                  detail={`Levels: ${game.highestLevel}/100`}
                  roofColor={palette.lilac}
                  bodyColor="#E9DBFF"
                  onPress={() => onOpen('puzzle')}
                />
                <HomeHouse
                  title="BOUTIQUE HOUSE"
                  action="GO TO BOUTIQUE"
                  detail={`Items Created: ${itemsCreated}`}
                  roofColor={palette.pinkDeep}
                  bodyColor="#FFE0EC"
                  fashion
                  onPress={() => onOpen('boutique')}
                />
              </View>

              <Fountain />
              <View style={styles.homeCharacterStage}>
                <View style={styles.leftCharacterCluster}>
                  <MiniCharacter type="redBoy" small />
                  <MiniCharacter type="robotCat" small />
                </View>
                <View style={styles.rightCharacterCluster}>
                  <MiniCharacter type="duo" small />
                  <MiniCharacter type="doll" small />
                </View>
              </View>
              <CharacterParade />
              <View style={styles.decorScatter}>
                {['hearts', 'bows', 'stars', 'candy', 'yarn', 'buttons', 'skirts', 'hangers', 'puzzles'].map((label, index) => (
                  <View key={label} style={[styles.scatterChip, { backgroundColor: itemColors[index % itemColors.length] }]}>
                    <Text style={styles.scatterText}>{label}</Text>
                  </View>
                ))}
              </View>
              </View>
            </View>

            <View style={styles.conceptCard}>
              <Text style={styles.conceptTitle}>Magical puzzle and fashion fair</Text>
              <Text style={styles.conceptText}>
                Win puzzle levels to unlock clothing designs, then sell them to boutique visitors for coins you can spend on continues.
              </Text>
            </View>
          </View>
        </ScrollView>
        <BottomNav onOpen={onOpen} />
      </View>
    </SafeAreaView>
  );
}

function ContinueModal({
  visible,
  reason,
  coins,
  onAd,
  onCoins,
  onHome,
}: {
  visible: boolean;
  reason: 'lost' | 'noLives' | null;
  coins: number;
  onAd: () => void;
  onCoins: () => void;
  onHome: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{reason === 'lost' ? 'Puzzle slipped!' : 'No lives left'}</Text>
          <Text style={styles.modalText}>
            {reason === 'lost'
              ? 'Continue this level with a pretend ad break or spend boutique coins.'
              : 'Lives refresh to 5 every 5 hours. You can still continue with an ad or coins.'}
          </Text>
          <CuteButton label="Watch ad to continue" onPress={onAd} tone="pink" wide />
          <CuteButton
            label={`Spend ${CONTINUE_COST} coins`}
            onPress={onCoins}
            tone={coins >= CONTINUE_COST ? 'yellow' : 'peach'}
            wide
          />
          <TouchableOpacity onPress={onHome} style={styles.modalPlainButton}>
            <Text style={styles.modalPlainText}>Return home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function RewardModal({
  item,
  onNext,
  onBoutique,
}: {
  item: FashionItem | null;
  onNext: () => void;
  onBoutique: () => void;
}) {
  return (
    <Modal transparent animationType="slide" visible={Boolean(item)}>
      <View style={styles.modalOverlay}>
        <View style={styles.rewardCard}>
          <Text style={styles.modalTitle}>New fashion item unlocked!</Text>
          {item ? (
            <>
              <FashionIcon item={item} size={100} />
              <Text style={styles.rewardName}>
                Level {item.level} {item.pattern} {item.type}
              </Text>
              <Text style={styles.modalText}>The puzzle pattern is now ready for the boutique rack.</Text>
            </>
          ) : null}
          <View style={styles.rewardActions}>
            <CuteButton label="Next level" onPress={onNext} tone="pink" />
            <CuteButton label="Boutique" onPress={onBoutique} tone="mint" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TinyYarnCat({ color, accent }: { color: string; accent: string }) {
  return (
    <View style={[styles.tinyYarnCat, { backgroundColor: color }]}>
      <View style={[styles.tinyCatEar, styles.tinyCatEarLeft, { borderBottomColor: color }]} />
      <View style={[styles.tinyCatEar, styles.tinyCatEarRight, { borderBottomColor: color }]} />
      <View style={styles.tinyCatEyeRow}>
        <View style={styles.tinyCatEye} />
        <View style={styles.tinyCatEye} />
      </View>
      <View style={[styles.tinyCatBell, { backgroundColor: accent }]} />
    </View>
  );
}

function LevelHudPill({
  icon,
  label,
  value,
  detail,
  color,
  plus = true,
}: {
  icon: string;
  label: string;
  value: string;
  detail?: string;
  color: string;
  plus?: boolean;
}) {
  return (
    <View style={styles.levelHudPill}>
      <View style={[styles.levelHudIcon, { backgroundColor: color }]}>
        <Text style={styles.levelHudIconText}>{icon}</Text>
      </View>
      <View style={styles.levelHudCopy}>
        <Text style={styles.levelHudLabel}>{label}</Text>
        <Text style={styles.levelHudValue}>{value}</Text>
        {detail ? <Text style={styles.levelHudDetail}>{detail}</Text> : null}
      </View>
      {plus ? (
        <View style={styles.levelHudPlus}>
          <Text style={styles.levelHudPlusText}>+</Text>
        </View>
      ) : null}
    </View>
  );
}

function LevelCloud({ style }: { style: object }) {
  return (
    <View style={[styles.levelCloud, style]}>
      <View style={styles.levelCloudPuffLarge} />
      <View style={styles.levelCloudPuffMedium} />
      <View style={styles.levelCloudPuffSmall} />
    </View>
  );
}

function LevelCastle() {
  return (
    <View style={styles.levelCastle}>
      <View style={styles.levelTowerSide}>
        <View style={styles.levelTowerRoof} />
        <View style={styles.levelTowerWindow} />
      </View>
      <View style={styles.levelCastleBody}>
        <View style={styles.levelCastleFlag} />
        <View style={styles.levelCastleDoor} />
      </View>
      <View style={styles.levelTowerSide}>
        <View style={[styles.levelTowerRoof, styles.levelTowerRoofPink]} />
        <View style={styles.levelTowerWindow} />
      </View>
    </View>
  );
}

function LevelGardenFlower({ color, style }: { color: string; style: object }) {
  return (
    <View style={[styles.levelFlower, style]}>
      {[0, 1, 2, 3, 4].map((petal) => (
        <View key={petal} style={[styles.levelFlowerPetal, { backgroundColor: color, transform: [{ rotate: `${petal * 72}deg` }, { translateY: -8 }] }]} />
      ))}
      <View style={styles.levelFlowerCenter} />
    </View>
  );
}

function LevelBlueWoolFriend() {
  return (
    <View style={styles.levelBlueFriend}>
      <View style={styles.levelBlueFriendEarLeft} />
      <View style={styles.levelBlueFriendEarRight} />
      <View style={styles.levelBlueFriendFace}>
        <View style={styles.levelBlueFriendEyes}>
          <View style={styles.levelBlueFriendEye} />
          <View style={styles.levelBlueFriendEye} />
        </View>
        <View style={styles.levelBlueFriendNose} />
        <View style={styles.levelBlueFriendSmile} />
      </View>
      <View style={styles.levelBlueFriendCollar}>
        <View style={styles.levelBlueFriendBell} />
      </View>
    </View>
  );
}

function LevelPuzzleHouseScene() {
  return (
    <View style={styles.levelPuzzleHouseScene}>
      <View style={styles.levelPuzzleHouseRoof} />
      <View style={styles.levelPuzzleHouseBody}>
        <View style={styles.levelPuzzleHouseWindow} />
        <Text style={styles.levelPuzzleHouseText}>PUZZLE{'\n'}HOUSE</Text>
        <View style={styles.levelPuzzleHouseDoor} />
      </View>
    </View>
  );
}

function WoolRobotCatPuzzle({ level }: { level: number }) {
  const yarnLines = Array.from({ length: 10 });

  return (
    <View style={styles.woolPuzzleCard}>
      <View style={styles.woolPuzzleHeader}>
        <Text style={styles.woolPuzzleKicker}>Level {level} yarn target</Text>
        <Text style={styles.woolPuzzleTitle}>Blue Wool Robot-Cat Puzzle</Text>
        <Text style={styles.woolPuzzleNote}>Original character made from soft wool loops and bright toy colors.</Text>
      </View>
      <View style={styles.woolStage}>
        <View style={styles.yarnCatBody}>
          {yarnLines.map((_, index) => (
            <View key={index} style={[styles.yarnStroke, { top: 14 + index * 13, opacity: 0.24 + (index % 3) * 0.08 }]} />
          ))}
          <View style={styles.yarnCatEarLeft} />
          <View style={styles.yarnCatEarRight} />
          <View style={styles.yarnCatFace}>
            <View style={styles.yarnEyeRow}>
              <View style={styles.yarnEye}>
                <View style={styles.yarnPupil} />
              </View>
              <View style={styles.yarnEye}>
                <View style={styles.yarnPupil} />
              </View>
            </View>
            <View style={styles.yarnNose} />
            <View style={styles.yarnSmile} />
            <View style={styles.yarnWhiskerLeft} />
            <View style={styles.yarnWhiskerRight} />
          </View>
          <View style={styles.yarnCollar}>
            <View style={styles.yarnBell} />
          </View>
        </View>
        <View style={styles.yarnCatFriendRow}>
          <TinyYarnCat color="#49B9F2" accent={palette.yellow} />
          <TinyYarnCat color={palette.white} accent={palette.pinkDeep} />
          <TinyYarnCat color="#FF6F91" accent={palette.yellow} />
          <TinyYarnCat color="#FFE46B" accent={palette.skyDeep} />
        </View>
      </View>
    </View>
  );
}

function getArrowSymbol(direction: CatDirection) {
  if (direction === 'up') {
    return '^';
  }
  if (direction === 'down') {
    return 'v';
  }
  if (direction === 'left') {
    return '<';
  }
  return '>';
}

function getLevelOneCounts(collectedIds: string[]) {
  const counts: Record<YarnColor, number> = {
    blue: 0,
    orange: 0,
    red: 0,
    white: 0,
    black: 0,
  };

  levelOneCats.forEach((cat) => {
    if (collectedIds.includes(cat.id)) {
      counts[cat.color] += 1;
    }
  });

  return counts;
}

function YarnGoalPill({ color, count, collected }: { color: YarnColor; count: number; collected: number }) {
  return (
    <View style={styles.yarnGoalPill}>
      <View style={[styles.yarnGoalSwatch, { backgroundColor: levelOneYarnColors[color] }]} />
      <Text style={styles.yarnGoalText}>{color} yarn x{count}</Text>
      <Text style={styles.yarnGoalCount}>{collected}/{count}</Text>
    </View>
  );
}

function DottedGuideline({ cat, scale }: { cat: LevelOneCat; scale: number }) {
  const isHorizontal = cat.direction === 'left' || cat.direction === 'right';
  const startX = Math.min(cat.start.x, cat.end.x) + 31;
  const startY = Math.min(cat.start.y, cat.end.y) + 31;
  const length = isHorizontal ? Math.abs(cat.start.x - cat.end.x) : Math.abs(cat.start.y - cat.end.y);
  const dotCount = Math.max(4, Math.floor(length / 14));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.dottedGuideline,
        {
          left: startX * scale,
          top: startY * scale,
          width: isHorizontal ? length * scale : 1,
          height: isHorizontal ? 1 : length * scale,
          flexDirection: isHorizontal ? 'row' : 'column',
        },
      ]}
    >
      {Array.from({ length: dotCount }).map((_, index) => (
        <View key={index} style={styles.guidelineDot} />
      ))}
    </View>
  );
}

function LevelOneCatToken({
  cat,
  scale,
  collected,
  onCollect,
}: {
  cat: LevelOneCat;
  scale: number;
  collected: boolean;
  onCollect: () => void;
}) {
  const position = useRef(new Animated.ValueXY({ x: cat.start.x * scale, y: cat.start.y * scale })).current;
  const color = levelOneYarnColors[cat.color];

  useEffect(() => {
    Animated.timing(position, {
      toValue: {
        x: (collected ? cat.end.x : cat.start.x) * scale,
        y: (collected ? cat.end.y : cat.start.y) * scale,
      },
      duration: collected ? 460 : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cat.end.x, cat.end.y, cat.start.x, cat.start.y, collected, position, scale]);

  return (
    <Animated.View style={[styles.levelOneCatTokenWrap, { transform: position.getTranslateTransform() }]}>
      <TouchableOpacity activeOpacity={0.8} disabled={collected} onPress={onCollect} style={[styles.levelOneCatToken, { backgroundColor: color, opacity: collected ? 0.48 : 1 }]}>
        <View style={[styles.levelOneCatEar, styles.levelOneCatEarLeft, { borderBottomColor: color }]} />
        <View style={[styles.levelOneCatEar, styles.levelOneCatEarRight, { borderBottomColor: color }]} />
        <View style={[styles.levelOneCatFace, cat.color === 'black' && styles.darkCatFace]}>
          <View style={styles.levelOneCatEyes}>
            <View style={styles.levelOneCatEye} />
            <View style={styles.levelOneCatEye} />
          </View>
          <Text style={[styles.levelOneCatArrow, cat.color === 'black' && styles.darkCatArrow]}>{getArrowSymbol(cat.direction)}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function LevelOneRobotPuzzle({ counts, complete }: { counts: Record<YarnColor, number>; complete: boolean }) {
  const totalCollected = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const totalRequired = Object.values(levelOneGoal).reduce((sum, count) => sum + count, 0);

  return (
    <View style={[styles.levelOneRobot, complete && styles.levelOneRobotComplete]}>
      <View style={styles.levelOneRobotEarLeft} />
      <View style={styles.levelOneRobotEarRight} />
      <View style={styles.levelOneRobotFace}>
        <View style={styles.levelOneRobotEyes}>
          <View style={styles.levelOneRobotEye}>
            <View style={styles.levelOneRobotPupil} />
          </View>
          <View style={styles.levelOneRobotEye}>
            <View style={styles.levelOneRobotPupil} />
          </View>
        </View>
        <View style={styles.levelOneRobotNose} />
        <View style={styles.levelOneRobotSmile} />
      </View>
      <View style={styles.levelOneRobotCollar}>
        <View style={styles.levelOneRobotBell} />
      </View>
      <View style={styles.levelOneYarnSlots}>
        {(Object.keys(levelOneGoal) as YarnColor[]).map((color) =>
          Array.from({ length: levelOneGoal[color] }).map((_, index) => {
            const filled = index < counts[color];
            return <View key={`${color}-${index}`} style={[styles.levelOneYarnSlot, { backgroundColor: filled ? levelOneYarnColors[color] : '#D7EAF2' }]} />;
          }),
        )}
      </View>
      <Text style={styles.levelOneRobotProgress}>{totalCollected}/{totalRequired} yarn</Text>
    </View>
  );
}

function LevelOneGameplayScreen({
  game,
  setGame,
  onHome,
  onBoutique,
}: {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState>>;
  onHome: () => void;
  onBoutique: () => void;
}) {
  const { width } = useWindowDimensions();
  const boardWidth = Math.min(360, width - 24);
  const boardHeight = boardWidth * 1.24;
  const scale = boardWidth / 360;
  const [collectedIds, setCollectedIds] = useState<string[]>([]);
  const [reward, setReward] = useState<FashionItem | null>(null);
  const [message, setMessage] = useState('Slide the cats in the arrow direction!');
  const counts = getLevelOneCounts(collectedIds);
  const complete = collectedIds.length === levelOneCats.length;

  const winLevelOne = () => {
    if (reward) {
      return;
    }

    const item = createFashionItem(1);
    setReward(item);
    setMessage('All yarn collected. The wool puzzle is complete.');
    setGame((previous) => {
      const refreshed = applyLifeRefresh(previous);
      const alreadyUnlocked = refreshed.clothes.some((clothing) => clothing.id === item.id);

      return {
        ...refreshed,
        highestLevel: Math.max(refreshed.highestLevel, 1),
        currentLevel: 1,
        clothes: alreadyUnlocked ? refreshed.clothes : [...refreshed.clothes, item],
      };
    });
  };

  const collectCat = (cat: LevelOneCat) => {
    if (reward || collectedIds.includes(cat.id)) {
      return;
    }

    const nextCollected = [...collectedIds, cat.id];
    setCollectedIds(nextCollected);
    setMessage(`${cat.color} yarn collected. Complete the wool puzzle.`);

    if (nextCollected.length === levelOneCats.length) {
      setTimeout(winLevelOne, 520);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.levelOneScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.levelOneTopBar}>
          <TouchableOpacity activeOpacity={0.82} onPress={onHome} style={styles.levelOneBackButton}>
            <Text style={styles.levelOneBackText}>{'<'}</Text>
          </TouchableOpacity>
          <View>
            <Text style={styles.levelOneKicker}>LEVEL 1</Text>
            <Text style={styles.levelOneTitle}>Wool Robot-Cat Puzzle</Text>
          </View>
          <View style={styles.levelOneLivesPill}>
            <Text style={styles.levelOneLivesText}>{game.lives} FULL</Text>
          </View>
        </View>

        <View style={styles.levelOneTutorialCard}>
          <Text style={styles.levelOneTutorialPrimary}>Slide the cats in the arrow direction!</Text>
          <Text style={styles.levelOneTutorialSecondary}>Collect all yarn and complete the wool puzzle!</Text>
        </View>

        <View style={styles.levelOneGoalPanel}>
          {(Object.keys(levelOneGoal) as YarnColor[]).map((color) => (
            <YarnGoalPill key={color} color={color} count={levelOneGoal[color]} collected={counts[color]} />
          ))}
        </View>

        <View style={[styles.levelOneBoard, { width: boardWidth, height: boardHeight }]}>
          <SparkleField count={18} />
          <View style={styles.levelOneBoardGlow} />
          <LevelOneRobotPuzzle counts={counts} complete={complete} />

          {levelOneCats.map((cat) => (
            <DottedGuideline key={`${cat.id}-path`} cat={cat} scale={scale} />
          ))}

          <View style={[styles.levelOneTargetZone, styles.levelOneTargetBlue]}>
            <Text style={styles.levelOneTargetText}>blue</Text>
          </View>
          <View style={[styles.levelOneTargetZone, styles.levelOneTargetWarm]}>
            <Text style={styles.levelOneTargetText}>warm</Text>
          </View>
          <View style={[styles.levelOneTargetZone, styles.levelOneTargetLight]}>
            <Text style={styles.levelOneTargetText}>light</Text>
          </View>
          <View style={[styles.levelOneTargetZone, styles.levelOneTargetDark]}>
            <Text style={styles.levelOneTargetText}>black</Text>
          </View>

          {levelOneCats.map((cat) => (
            <LevelOneCatToken key={cat.id} cat={cat} scale={scale} collected={collectedIds.includes(cat.id)} onCollect={() => collectCat(cat)} />
          ))}
        </View>

        <Text style={styles.levelOneMessage}>{message}</Text>
      </ScrollView>

      <RewardModal
        item={reward}
        onNext={() => {
          setReward(null);
          onHome();
        }}
        onBoutique={onBoutique}
      />
    </SafeAreaView>
  );
}

function PuzzleScreen({
  game,
  setGame,
  onHome,
  onBoutique,
}: {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState>>;
  onHome: () => void;
  onBoutique: () => void;
}) {
  const level = clampLevel(game.currentLevel);

  if (level === 1) {
    return <LevelOneGameplayScreen game={game} setGame={setGame} onHome={onHome} onBoutique={onBoutique} />;
  }

  const puzzle = useMemo(() => createPuzzle(level), [level]);
  const [rotations, setRotations] = useState(puzzle.initial);
  const [movesLeft, setMovesLeft] = useState(puzzle.moves);
  const [continueReason, setContinueReason] = useState<'lost' | 'noLives' | null>(null);
  const [continuePass, setContinuePass] = useState(false);
  const [reward, setReward] = useState<FashionItem | null>(null);
  const [message, setMessage] = useState('Tap each wool patch until its color matches the tiny target dot.');

  useEffect(() => {
    setRotations(puzzle.initial);
    setMovesLeft(puzzle.moves);
    setContinuePass(false);
    setReward(null);
    setMessage('Tap each wool patch until its color matches the tiny target dot.');
    setContinueReason(game.lives <= 0 ? 'noLives' : null);
  }, [level, puzzle.initial, puzzle.moves]);

  const isSolved = (nextRotations: number[]) => nextRotations.every((direction, index) => direction === puzzle.target[index]);

  const resetPuzzle = (text = 'Fresh try. Match the wool colors to finish the toy pattern.') => {
    setRotations(puzzle.initial);
    setMovesLeft(puzzle.moves);
    setMessage(text);
    setContinueReason(null);
  };

  const loseLevel = () => {
    setGame((previous) => {
      const refreshed = applyLifeRefresh(previous);

      if (refreshed.lives <= 0) {
        return refreshed;
      }

      return {
        ...refreshed,
        lives: refreshed.lives - 1,
        lastLifeRefresh: refreshed.lives === MAX_LIVES ? Date.now() : refreshed.lastLifeRefresh,
      };
    });
    setContinuePass(false);
    setContinueReason('lost');
    setMessage('Out of moves. One life was used.');
  };

  const winLevel = () => {
    const item = createFashionItem(level);
    setReward(item);
    setMessage('Wool pattern complete. It turned into fashion.');

    setGame((previous) => {
      const refreshed = applyLifeRefresh(previous);
      const alreadyUnlocked = refreshed.clothes.some((clothing) => clothing.id === item.id);
      const nextLevel = clampLevel(level + 1);

      return {
        ...refreshed,
        highestLevel: Math.max(refreshed.highestLevel, nextLevel),
        clothes: alreadyUnlocked ? refreshed.clothes : [...refreshed.clothes, item],
      };
    });
  };

  const changePatchColor = (index: number) => {
    if (reward || continueReason) {
      return;
    }

    if (game.lives <= 0 && !continuePass) {
      setContinueReason('noLives');
      return;
    }

    const nextMoves = movesLeft - 1;
    const nextRotations = rotations.map((direction, rotationIndex) => (rotationIndex === index ? (direction + 1) % 4 : direction));
    setRotations(nextRotations);
    setMovesLeft(nextMoves);

    if (isSolved(nextRotations)) {
      winLevel();
      return;
    }

    if (nextMoves <= 0) {
      loseLevel();
    }
  };

  const continueWithAd = () => {
    setContinuePass(true);
    resetPuzzle('Ad watched. Continue matching the wool colors.');
  };

  const continueWithCoins = () => {
    if (game.coins < CONTINUE_COST) {
      setMessage('Not enough coins yet. Sell boutique items or watch an ad.');
      return;
    }

    setGame((previous) => ({
      ...previous,
      coins: Math.max(0, previous.coins - CONTINUE_COST),
    }));
    setContinuePass(true);
    resetPuzzle(`${CONTINUE_COST} coins spent. Continue this level.`);
  };

  const boardWidth = Math.min(330, Math.max(280, useWindowDimensions().width - 44));
  const tileGap = 8;
  const tileSize = (boardWidth - tileGap * (puzzle.size - 1)) / puzzle.size;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.puzzleScroll} showsVerticalScrollIndicator={false}>
        <Header title="Puzzle House" onBack={onHome} game={game} />

        <View style={styles.levelBanner}>
          <View>
            <Text style={styles.kicker}>Level {level} of 100</Text>
            <Text style={styles.sectionTitle}>Wool toy color puzzle</Text>
          </View>
          <View style={styles.movesBadge}>
            <Text style={styles.movesNumber}>{movesLeft}</Text>
            <Text style={styles.movesLabel}>moves</Text>
          </View>
        </View>

        <WoolRobotCatPuzzle level={level} />

        <View style={[styles.puzzleBoard, styles.woolMatchBoard, { width: boardWidth }]}>
          {rotations.map((direction, index) => {
            const solved = direction === puzzle.target[index];
            const targetColor = puzzle.colors[index];
            const currentColor = puzzle.colors[(direction + index) % puzzle.colors.length];

            return (
              <Pressable
                key={`${level}-${index}`}
                onPress={() => changePatchColor(index)}
                style={[
                  styles.puzzleTile,
                  styles.woolPatchTile,
                  {
                    width: tileSize,
                    height: tileSize,
                    marginRight: (index + 1) % puzzle.size === 0 ? 0 : tileGap,
                    marginBottom: index >= puzzle.size * (puzzle.size - 1) ? 0 : tileGap,
                    backgroundColor: solved ? targetColor : currentColor,
                  },
                ]}
              >
                <View style={[styles.woolTargetDot, { backgroundColor: targetColor }]} />
                <View style={styles.woolPatchYarnLines}>
                  <View style={styles.woolPatchLine} />
                  <View style={[styles.woolPatchLine, styles.woolPatchLineShort]} />
                  <View style={styles.woolPatchLine} />
                </View>
                <Text style={styles.woolPatchLabel}>{solved ? 'match' : 'tap'}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.helperText}>{message}</Text>

        <View style={styles.puzzleActions}>
          <CuteButton label="Try reset" onPress={() => resetPuzzle()} tone="lavender" />
          <CuteButton label="Lose test" onPress={loseLevel} tone="peach" />
          <CuteButton label="Levels" onPress={() => setGame((previous) => ({ ...previous, currentLevel: previous.highestLevel }))} tone="mint" />
        </View>

        <View style={styles.previewRack}>
          <Text style={styles.previewTitle}>Win reward preview</Text>
          <FashionIcon item={createFashionItem(level)} size={72} />
          <Text style={styles.previewCopy}>{createFashionItem(level).pattern} {createFashionItem(level).type}</Text>
        </View>
      </ScrollView>

      <ContinueModal
        visible={Boolean(continueReason)}
        reason={continueReason}
        coins={game.coins}
        onAd={continueWithAd}
        onCoins={continueWithCoins}
        onHome={onHome}
      />
      <RewardModal
        item={reward}
        onNext={() => {
          setReward(null);
          setGame((previous) => ({ ...previous, currentLevel: clampLevel(level + 1) }));
        }}
        onBoutique={onBoutique}
      />
    </SafeAreaView>
  );
}

function BoutiqueScreen({
  game,
  setGame,
  onHome,
}: {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState>>;
  onHome: () => void;
}) {
  const unsoldItems = useMemo(() => game.clothes.filter((item) => !item.sold), [game.clothes]);
  const [requestId, setRequestId] = useState<string | null>(unsoldItems[0]?.id ?? null);
  const [reaction, setReaction] = useState('Tap the requested item on the rack to sell it.');
  const request = unsoldItems.find((item) => item.id === requestId) ?? unsoldItems[0] ?? null;

  useEffect(() => {
    if (!request && unsoldItems.length > 0) {
      setRequestId(unsoldItems[0].id);
    }

    if (request && !unsoldItems.some((item) => item.id === request.id)) {
      setRequestId(unsoldItems[0]?.id ?? null);
    }
  }, [request, unsoldItems]);

  const sellItem = (item: FashionItem) => {
    if (!request) {
      setReaction('No customer is waiting for that item yet.');
      return;
    }

    if (item.id !== request.id) {
      setReaction(`Cute choice, but this visitor asked for the ${request.pattern} ${request.type}.`);
      return;
    }

    setGame((previous) => ({
      ...previous,
      coins: previous.coins + item.price,
      clothes: previous.clothes.map((clothing) => (clothing.id === item.id ? { ...clothing, sold: true } : clothing)),
    }));
    setReaction(`Sold for ${item.price} coins. The customer loved the ${item.pattern} look.`);

    const nextItem = unsoldItems.find((candidate) => candidate.id !== item.id);
    setRequestId(nextItem?.id ?? null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screenRoot}>
        <Header title="Boutique House" onBack={onHome} game={game} />
        <Customer request={request} />

        <View style={styles.boutiqueCounter}>
          <Text style={styles.sectionTitle}>Closet rack</Text>
          <Text style={styles.helperText}>{reaction}</Text>
        </View>

        {game.clothes.length === 0 ? (
          <View style={styles.emptyBoutique}>
            <Text style={styles.emptyTitle}>The racks are waiting.</Text>
            <Text style={styles.emptyText}>Win puzzle levels to turn patterns into shirts, skirts, bags, hats, and more.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.rackGrid} showsVerticalScrollIndicator={false}>
            {game.clothes.map((item) => (
              <TouchableOpacity
                key={item.id}
                activeOpacity={item.sold ? 1 : 0.78}
                disabled={item.sold}
                onPress={() => sellItem(item)}
                style={[styles.rackItem, item.id === request?.id && styles.requestedRackItem, item.sold && styles.soldRackItem]}
              >
                <FashionIcon item={item} size={70} />
                <Text style={styles.itemName}>{item.pattern}</Text>
                <Text style={styles.itemMeta}>
                  {item.type} - {item.sold ? 'sold' : `${item.price} coins`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

function LevelsScreen({
  game,
  setGame,
  onPlay,
  onHome,
  onOpen,
}: {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState>>;
  onPlay: () => void;
  onHome: () => void;
  onOpen: (screen: Screen) => void;
}) {
  const { width } = useWindowDimensions();
  const levelGap = 5;
  const levelSize = Math.max(31, Math.min(56, (width - 30 - levelGap * 9) / 10));

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.levelsRoot}>
        <View pointerEvents="none" style={styles.levelsBackdrop}>
          <SparkleField count={46} />
          <View style={styles.levelRainbow} />
          <LevelCloud style={styles.levelCloudLeft} />
          <LevelCloud style={styles.levelCloudRight} />
          <LevelCloud style={styles.levelCloudCenter} />
          <HotAirBalloon color={palette.pink} style={styles.levelBalloonLeft} delay={200} />
          <HotAirBalloon color={palette.yellow} style={styles.levelBalloonRight} delay={700} />
          <LevelCastle />
          <View style={styles.levelTreeLeft} />
          <View style={styles.levelTreeRight} />
          <View style={styles.levelBunting}>
            {Array.from({ length: 9 }).map((_, index) => (
              <View key={index} style={[styles.levelBuntingFlag, { backgroundColor: itemColors[index % itemColors.length] }]} />
            ))}
          </View>
          <LevelGardenFlower color={palette.pinkDeep} style={styles.levelFlowerLeftOne} />
          <LevelGardenFlower color={palette.lilac} style={styles.levelFlowerLeftTwo} />
          <LevelGardenFlower color={palette.yellow} style={styles.levelFlowerRightOne} />
          <LevelGardenFlower color={palette.skyDeep} style={styles.levelFlowerRightTwo} />
        </View>

        <View style={styles.levelsHud}>
          <View style={styles.levelPlayerHud}>
            <PlayerProfile level={game.highestLevel} />
            <View style={styles.levelProgressTrack}>
              <View style={[styles.levelProgressFill, { width: `${Math.min(100, game.highestLevel)}%` }]} />
              <Text style={styles.levelProgressText}>{Math.min(game.highestLevel - 1, LEVEL_COUNT)}/100</Text>
            </View>
          </View>
          <View style={styles.levelsHudResources}>
            <LevelHudPill icon="5" label="Lives" value={`${game.lives} FULL`} detail="Resets in: 05:00:00" color={palette.pinkDeep} />
            <LevelHudPill icon="$" label="Coins" value="0" color={palette.yellow} />
            <LevelHudPill icon="G" label="Gems" value="0" color={palette.lilac} />
          </View>
          <TouchableOpacity activeOpacity={0.82} onPress={onHome} style={styles.levelSettingsButton}>
            <Text style={styles.levelSettingsText}>SET</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.8} onPress={onHome} style={styles.levelsBackButton}>
          <Text style={styles.levelsBackText}>{'<'}</Text>
        </TouchableOpacity>

        <View style={styles.levelsRibbon}>
          <View style={styles.ribbonTailLeft} />
          <View style={styles.ribbonStarBadge}>
            <Text style={styles.ribbonStarText}>*</Text>
          </View>
          <Text style={styles.levelsRibbonText}>LEVELS</Text>
          <View style={styles.ribbonBow}>
            <View style={styles.ribbonBowWing} />
            <View style={styles.ribbonBowKnot} />
            <View style={styles.ribbonBowWing} />
          </View>
          <View style={styles.ribbonTailRight} />
          <View style={styles.ribbonButtonLeft} />
          <View style={styles.ribbonButtonRight} />
        </View>

        <ScrollView contentContainerStyle={styles.levelsScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.levelsGridPanel}>
            {Array.from({ length: LEVEL_COUNT }, (_, index) => index + 1).map((level) => {
              const unlocked = level === 1;
              const isCurrent = level === 1;

              return (
                <TouchableOpacity
                  key={level}
                  activeOpacity={unlocked ? 0.78 : 1}
                  disabled={!unlocked}
                  onPress={() => {
                    setGame((previous) => ({ ...previous, currentLevel: level }));
                    onPlay();
                  }}
                  style={[
                    styles.storyLevelBubble,
                    {
                      width: levelSize,
                      height: levelSize,
                      borderRadius: levelSize / 2,
                      marginRight: level % 10 === 0 ? 0 : levelGap,
                    },
                    unlocked && styles.playedStoryLevel,
                    level % 10 === 0 && styles.bonusStoryLevel,
                    isCurrent && styles.currentStoryLevel,
                    !unlocked && styles.lockedStoryLevel,
                  ]}
                >
                  <View style={[styles.storyLevelCatEar, styles.storyLevelCatEarLeft, { borderBottomColor: unlocked ? palette.pinkDeep : '#EAD8CF' }]} />
                  <View style={[styles.storyLevelCatEar, styles.storyLevelCatEarRight, { borderBottomColor: unlocked ? palette.pinkDeep : '#EAD8CF' }]} />
                  <Text style={[styles.storyLevelText, level % 10 === 0 && styles.tenthLevelText]}>{level}</Text>
                  {unlocked ? (
                    <View style={styles.storyStarRow}>
                      {[0, 1, 2].map((star) => (
                        <View key={star} style={styles.storyStar}>
                          <Text style={styles.storyStarText}>*</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.storyLockedLevelText}>lock</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.levelsGarden}>
            <View style={styles.levelsSign}>
              <Text style={styles.levelsSignLine}>+ Solve Puzzles</Text>
              <Text style={styles.levelsSignLine}>Dress Unlock Fashion!</Text>
              <Text style={styles.levelsSignLine}>Heart Have Fun!</Text>
            </View>
            <Fountain />
            <View style={styles.levelsCharacterGroup}>
              <LevelBlueWoolFriend />
              <View style={styles.levelTeddy}>
                <View style={styles.levelTeddyEarLeft} />
                <View style={styles.levelTeddyEarRight} />
                <View style={styles.levelTeddyFace} />
              </View>
              <View style={styles.levelPuppy}>
                <View style={styles.levelPuppyEar} />
                <View style={styles.levelPuppyFace} />
              </View>
            </View>
            <LevelPuzzleHouseScene />
          </View>
        </ScrollView>
        <BottomNav onOpen={onOpen} />
      </View>
    </SafeAreaView>
  );
}

function SettingsScreen({
  game,
  setGame,
  onHome,
}: {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState>>;
  onHome: () => void;
}) {
  const resetSave = () => {
    setGame({
      ...defaultGameState,
      lastLifeRefresh: Date.now(),
    });
  };

  const fillLives = () => {
    setGame((previous) => ({
      ...previous,
      lives: MAX_LIVES,
      lastLifeRefresh: Date.now(),
    }));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screenRoot}>
        <Header title="Settings" onBack={onHome} game={game} />
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Save data</Text>
          <Text style={styles.helperText}>Progress, lives, boutique coins, and unlocked clothes are stored with AsyncStorage.</Text>
          <View style={styles.settingsRows}>
            <Text style={styles.settingLine}>Highest level: {game.highestLevel}</Text>
            <Text style={styles.settingLine}>Lives refresh: {formatRefreshTime(game.lastLifeRefresh, game.lives)}</Text>
            <Text style={styles.settingLine}>Unlocked clothes: {game.clothes.length}</Text>
            <Text style={styles.settingLine}>Unsold boutique stock: {game.clothes.filter((item) => !item.sold).length}</Text>
          </View>
          <CuteButton label="Refresh lives for testing" onPress={fillLives} tone="mint" wide />
          <CuteButton label="Reset save" onPress={resetSave} tone="peach" wide />
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [game, setGame] = useState<GameState>(defaultGameState);
  const [screen, setScreen] = useState<Screen>('home');
  const [loaded, setLoaded] = useState(false);
  const [loadingIntroDone, setLoadingIntroDone] = useState(false);

  useEffect(() => {
    async function loadSave() {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        setGame(normaliseSave(stored ? (JSON.parse(stored) as Partial<GameState>) : null));
      } catch {
        setGame(defaultGameState);
      } finally {
        setLoaded(true);
      }
    }

    loadSave();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setLoadingIntroDone(true), 1600);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(game)).catch(() => {
      // Saving failures are non-blocking for gameplay.
    });
  }, [game, loaded]);

  useEffect(() => {
    const timer = setInterval(() => {
      setGame((previous) => applyLifeRefresh(previous));
    }, 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  if (!loaded || !loadingIntroDone) {
    return <LoadingScreen />;
  }

  if (screen === 'puzzle') {
    return <PuzzleScreen game={game} setGame={setGame} onHome={() => setScreen('home')} onBoutique={() => setScreen('boutique')} />;
  }

  if (screen === 'boutique') {
    return <BoutiqueScreen game={game} setGame={setGame} onHome={() => setScreen('home')} />;
  }

  if (screen === 'levels') {
    return <LevelsScreen game={game} setGame={setGame} onHome={() => setScreen('home')} onPlay={() => setScreen('puzzle')} onOpen={setScreen} />;
  }

  if (screen === 'settings') {
    return <SettingsScreen game={game} setGame={setGame} onHome={() => setScreen('home')} />;
  }

  return <HomeScreen game={game} onOpen={setScreen} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.cream,
  },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cream,
    padding: 24,
  },
  homeRoot: {
    flex: 1,
    backgroundColor: '#24307C',
    overflow: 'hidden',
  },
  homeScroll: {
    paddingBottom: 112,
  },
  homeSky: {
    minHeight: 884,
    paddingHorizontal: 10,
    paddingBottom: 18,
    backgroundColor: '#172D91',
    overflow: 'hidden',
  },
  sparkleField: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sparkleDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.78)',
  },
  loadingScene: {
    flex: 1,
    backgroundColor: '#FAB9EA',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 34,
    overflow: 'hidden',
  },
  loadingBackdropGlow: {
    position: 'absolute',
    top: 112,
    width: 360,
    height: 420,
    borderRadius: 180,
    backgroundColor: '#FFEAF7',
    opacity: 0.78,
  },
  collageSticker: {
    position: 'absolute',
    minWidth: 58,
    minHeight: 42,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    shadowColor: '#B0529A',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  collageStickerShine: {
    position: 'absolute',
    top: 5,
    left: 9,
    right: 9,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.46)',
  },
  collageStickerText: {
    color: palette.white,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  loadingBow: {
    top: 86,
    left: 10,
    minWidth: 62,
    minHeight: 44,
  },
  loadingStickerButton: {
    top: 48,
    left: 86,
    minWidth: 66,
    minHeight: 50,
  },
  loadingStickerCandy: {
    top: 50,
    right: 122,
    minWidth: 70,
    minHeight: 46,
  },
  loadingStickerYarn: {
    top: 38,
    right: 14,
    minWidth: 62,
    minHeight: 62,
    borderRadius: 31,
  },
  loadingStickerShirt: {
    top: 104,
    alignSelf: 'center',
    minWidth: 74,
    minHeight: 54,
  },
  loadingStickerSkirt: {
    top: 112,
    right: 64,
    minWidth: 78,
    minHeight: 54,
  },
  loadingStickerHanger: {
    top: 190,
    right: 8,
    minWidth: 72,
    minHeight: 42,
  },
  loadingCharactersTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 142,
    paddingHorizontal: 4,
  },
  loadingCenterSparkle: {
    position: 'absolute',
    top: 238,
    alignSelf: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.84)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 2,
    borderColor: palette.white,
  },
  loadingCenterSparkleText: {
    color: palette.lilac,
    fontWeight: '900',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  loadingCharactersBottom: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: -6,
  },
  loadingDecorCloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  tinyDecorPill: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: palette.white,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tinyDecorText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '900',
  },
  loadingBarFrame: {
    width: '90%',
    height: 28,
    borderRadius: 18,
    backgroundColor: '#F1F7FF',
    borderWidth: 3,
    borderColor: palette.white,
    overflow: 'hidden',
    shadowColor: palette.softShadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  loadingBarFill: {
    height: '100%',
    borderRadius: 15,
    backgroundColor: palette.pinkDeep,
  },
  loadingBarShine: {
    position: 'absolute',
    top: 3,
    left: 12,
    right: 12,
    height: 6,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.54)',
  },
  loadingWaitText: {
    color: palette.cocoa,
    fontSize: 16,
    fontWeight: '900',
    marginTop: -14,
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 34,
    backgroundColor: '#FFF1D8',
    borderWidth: 5,
    borderColor: palette.white,
    shadowColor: '#C88BFF',
    shadowOpacity: 0.46,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  logoWrapCompact: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 38,
  },
  logoBow: {
    position: 'absolute',
    top: -22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBowWing: {
    width: 38,
    height: 28,
    borderRadius: 16,
    backgroundColor: palette.pinkDeep,
    borderWidth: 3,
    borderColor: palette.white,
  },
  logoBowKnot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.pink,
    borderWidth: 3,
    borderColor: palette.white,
    marginHorizontal: -4,
    zIndex: 2,
  },
  logoStitchRow: {
    flexDirection: 'row',
    gap: 7,
    marginVertical: 4,
  },
  logoStitch: {
    width: 10,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#ED9EBB',
    opacity: 0.78,
  },
  logoText: {
    color: palette.pinkDeep,
    fontSize: 48,
    lineHeight: 50,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: '#8C407B',
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 3 },
  },
  logoTextCompact: {
    fontSize: 36,
    lineHeight: 38,
  },
  logoSecondLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoClosetText: {
    color: palette.lilac,
  },
  logoHanger: {
    width: 38,
    height: 28,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  logoHook: {
    width: 12,
    height: 12,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: palette.cocoa,
    borderTopLeftRadius: 10,
    transform: [{ rotate: '38deg' }],
    marginBottom: -2,
  },
  logoHangerLine: {
    width: 34,
    height: 16,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderColor: palette.cocoa,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  logoDecorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    marginTop: 6,
  },
  logoDecor: {
    color: palette.cocoa,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  topHud: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    zIndex: 5,
  },
  playerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 24,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
    backgroundColor: '#FDE0F0',
    borderWidth: 3,
    borderColor: palette.white,
    shadowColor: '#061151',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFD7C7',
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarHair: {
    width: 52,
    height: 17,
    backgroundColor: '#8E5C88',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  avatarEyeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 9,
  },
  avatarEye: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.cocoa,
  },
  avatarSmile: {
    width: 16,
    height: 7,
    borderBottomWidth: 2,
    borderBottomColor: palette.cocoa,
    borderRadius: 8,
    marginTop: 5,
  },
  playerName: {
    color: palette.cocoa,
    fontSize: 14,
    fontWeight: '900',
  },
  levelBadge: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    backgroundColor: palette.yellow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  levelBadgeText: {
    color: palette.cocoa,
    fontSize: 11,
    fontWeight: '900',
  },
  homeActions: {
    flexDirection: 'row',
    gap: 6,
  },
  homeActionRail: {
    position: 'absolute',
    top: 14,
    left: 8,
    zIndex: 10,
    gap: 8,
  },
  homeActionButton: {
    width: 64,
    minHeight: 44,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3FB',
    borderWidth: 3,
    borderColor: '#E7B9FF',
    shadowColor: '#061151',
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  homeActionIcon: {
    color: palette.pinkDeep,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeActionText: {
    color: palette.cocoa,
    fontSize: 10,
    fontWeight: '900',
  },
  resourceRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  resourceStack: {
    flex: 1,
    gap: 6,
  },
  resourceCard: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: '#EAECF8',
    borderWidth: 3,
    borderColor: palette.white,
    padding: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    shadowColor: '#061151',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  resourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.white,
  },
  resourceIconText: {
    color: palette.white,
    fontSize: 13,
    fontWeight: '900',
  },
  resourceCopy: {
    flex: 1,
  },
  resourceLabel: {
    color: '#8B6680',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  resourceValue: {
    color: palette.cocoa,
    fontSize: 15,
    fontWeight: '900',
  },
  resourceDetail: {
    color: '#8B6680',
    fontSize: 8,
    fontWeight: '800',
  },
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.mintDeep,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.white,
  },
  addButtonText: {
    color: palette.white,
    fontWeight: '900',
    lineHeight: 16,
  },
  nightGlowTop: {
    position: 'absolute',
    top: 20,
    left: -40,
    right: -40,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(101, 87, 218, 0.34)',
  },
  distantVillage: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 304,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    opacity: 0.52,
  },
  distantHouse: {
    width: 22,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 5,
  },
  distantWindow: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.yellow,
  },
  ferrisWheel: {
    position: 'absolute',
    top: 196,
    left: -18,
    width: 142,
    height: 168,
    alignItems: 'center',
  },
  ferrisRing: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 4,
    borderColor: '#FFE98A',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  ferrisSpoke: {
    position: 'absolute',
    width: 3,
    height: 94,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 2,
  },
  ferrisCabin: {
    position: 'absolute',
    width: 18,
    height: 16,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.white,
  },
  ferrisLegs: {
    flexDirection: 'row',
    gap: 28,
    marginTop: -2,
  },
  ferrisLegLeft: {
    width: 4,
    height: 54,
    backgroundColor: palette.white,
    transform: [{ rotate: '15deg' }],
  },
  ferrisLegRight: {
    width: 4,
    height: 54,
    backgroundColor: palette.white,
    transform: [{ rotate: '-15deg' }],
  },
  balloonWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  balloonTop: {
    width: 44,
    height: 56,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: palette.white,
    overflow: 'hidden',
    alignItems: 'center',
  },
  balloonStripe: {
    width: 14,
    height: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  balloonBasket: {
    width: 22,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#C88965',
    borderWidth: 2,
    borderColor: palette.white,
    marginTop: 3,
  },
  homeBalloonOne: {
    left: 112,
    top: 156,
  },
  homeBalloonTwo: {
    right: 26,
    top: 224,
  },
  firework: {
    position: 'absolute',
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fireworkRay: {
    position: 'absolute',
    width: 3,
    height: 50,
    borderRadius: 2,
    backgroundColor: palette.yellow,
  },
  fireworkOne: {
    top: 110,
    left: 44,
  },
  fireworkTwo: {
    top: 128,
    right: 70,
  },
  homeStarOne: {
    top: 245,
    left: 7,
    width: 42,
    height: 42,
    borderRadius: 9,
  },
  homeHeartOne: {
    top: 312,
    right: 4,
    width: 42,
    height: 42,
  },
  homeBowOne: {
    top: 390,
    left: 12,
    width: 46,
    height: 36,
    borderRadius: 16,
  },
  funFairSign: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: -18,
    zIndex: 4,
    backgroundColor: '#A85E43',
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#F8D0A1',
    paddingHorizontal: 18,
    paddingVertical: 8,
    alignItems: 'center',
    shadowColor: '#190A44',
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  funFairText: {
    color: palette.white,
    fontSize: 15,
    fontWeight: '900',
  },
  funFairHeart: {
    color: palette.pink,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  homeBoardFrame: {
    marginTop: 10,
    minHeight: 642,
    borderRadius: 30,
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    backgroundColor: 'rgba(58, 75, 161, 0.88)',
    paddingTop: 14,
    paddingHorizontal: 8,
    overflow: 'hidden',
    shadowColor: '#061151',
    shadowOpacity: 0.36,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fairgroundScene: {
    marginTop: -4,
    minHeight: 456,
    borderRadius: 24,
    backgroundColor: 'rgba(34, 49, 137, 0.34)',
    borderWidth: 0,
    overflow: 'hidden',
    paddingTop: 38,
  },
  fairyLightBridge: {
    position: 'absolute',
    top: 112,
    left: 80,
    right: 8,
    height: 36,
    borderTopWidth: 3,
    borderTopColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 80,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingTop: 10,
  },
  bridgeLight: {
    width: 11,
    height: 15,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  pathway: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: -90,
    width: 190,
    height: 344,
    borderRadius: 96,
    backgroundColor: '#FFD6B3',
    opacity: 0.92,
  },
  flowerPatchLeft: {
    position: 'absolute',
    left: 8,
    bottom: 122,
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 58,
    gap: 5,
  },
  flowerPatchRight: {
    position: 'absolute',
    right: 8,
    bottom: 122,
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 58,
    gap: 5,
  },
  flowerDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: palette.white,
  },
  mainHousesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  bigHouseWrap: {
    flex: 1,
  },
  bigHouseTap: {
    alignItems: 'center',
  },
  bigHouseRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 68,
    borderRightWidth: 68,
    borderBottomWidth: 72,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  bigHouseBody: {
    width: '100%',
    minHeight: 238,
    borderRadius: 22,
    borderWidth: 4,
    borderColor: palette.white,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#C58CD8',
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  houseGlowLights: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 8,
  },
  houseMiniLight: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.white,
  },
  bigWindowRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bigWindow: {
    width: 54,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#B8E8FF',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowIcon: {
    color: palette.cocoa,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  bigHouseTitle: {
    color: '#6E4B61',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 10,
  },
  bigHouseDetail: {
    color: '#805C74',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
  },
  housePlayButton: {
    marginTop: 12,
    borderRadius: 26,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 3,
    borderColor: palette.white,
  },
  housePlayText: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  fountainWrap: {
    alignSelf: 'center',
    width: 150,
    height: 132,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  fountainGlow: {
    position: 'absolute',
    bottom: 10,
    width: 164,
    height: 86,
    borderRadius: 82,
    backgroundColor: '#BFE9FF',
    opacity: 0.44,
  },
  fountainSpray: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fountainDrop: {
    width: 22,
    height: 38,
    borderRadius: 15,
    backgroundColor: '#9DE7FF',
    borderWidth: 2,
    borderColor: palette.white,
  },
  fountainDropSmall: {
    position: 'absolute',
    width: 15,
    height: 26,
    left: -20,
    top: 13,
    transform: [{ rotate: '-25deg' }],
  },
  fountainDropTiny: {
    position: 'absolute',
    width: 15,
    height: 26,
    right: -20,
    top: 13,
    transform: [{ rotate: '25deg' }],
  },
  fountainBowl: {
    width: 132,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#C9F3FF',
    borderWidth: 4,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fountainWater: {
    width: 82,
    height: 22,
    borderRadius: 15,
    backgroundColor: '#78D8FF',
  },
  fountainBase: {
    width: 58,
    height: 22,
    borderRadius: 8,
    backgroundColor: '#F6C2DF',
    borderWidth: 3,
    borderColor: palette.white,
    marginTop: -2,
  },
  characterParade: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 8,
    marginTop: 0,
  },
  homeCharacterStage: {
    minHeight: 38,
    marginTop: -6,
  },
  leftCharacterCluster: {
    position: 'absolute',
    left: 10,
    top: -26,
    flexDirection: 'row',
  },
  rightCharacterCluster: {
    position: 'absolute',
    right: 8,
    top: -22,
    flexDirection: 'row',
  },
  characterToken: {
    width: 70,
    height: 78,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.softShadow,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  smallToken: {
    transform: [{ scale: 0.76 }],
    marginHorizontal: -5,
    marginVertical: -7,
  },
  characterEarLeft: {
    position: 'absolute',
    top: -6,
    left: 11,
    width: 18,
    height: 18,
    borderRadius: 6,
    transform: [{ rotate: '-24deg' }],
    borderWidth: 2,
    borderColor: palette.white,
  },
  characterEarRight: {
    position: 'absolute',
    top: -6,
    right: 11,
    width: 18,
    height: 18,
    borderRadius: 6,
    transform: [{ rotate: '24deg' }],
    borderWidth: 2,
    borderColor: palette.white,
  },
  characterEyeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  characterEye: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.cocoa,
  },
  characterSmileLine: {
    width: 20,
    height: 10,
    borderBottomWidth: 3,
    borderBottomColor: palette.cocoa,
    borderRadius: 10,
    marginTop: 6,
  },
  characterLabel: {
    color: palette.cocoa,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
  },
  duoToken: {
    width: 78,
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: -10,
  },
  duoFriend: {
    width: 44,
    height: 52,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: palette.white,
  },
  bugRow: {
    width: 72,
    height: 42,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 2,
    borderColor: palette.white,
  },
  tinyBug: {
    width: 14,
    height: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  carBody: {
    width: 76,
    height: 42,
    borderRadius: 18,
    backgroundColor: palette.skyDeep,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carWindow: {
    width: 30,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.white,
    marginTop: -10,
  },
  carWheelRow: {
    position: 'absolute',
    bottom: -8,
    flexDirection: 'row',
    gap: 30,
  },
  carWheel: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: palette.cocoa,
    borderWidth: 2,
    borderColor: palette.white,
  },
  decorScatter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  scatterChip: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 2,
    borderColor: palette.white,
  },
  scatterText: {
    color: palette.white,
    fontSize: 9,
    fontWeight: '900',
  },
  conceptCard: {
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.84)',
    borderWidth: 2,
    borderColor: palette.white,
    padding: 12,
  },
  conceptTitle: {
    color: palette.cocoa,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  conceptText: {
    color: '#7C5A69',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
  bottomNav: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    minHeight: 76,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 3,
    borderColor: palette.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: palette.softShadow,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  navButton: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: {
    color: palette.lilac,
    fontSize: 13,
    fontWeight: '900',
  },
  navText: {
    color: palette.cocoa,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 2,
  },
  playNavButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: palette.pinkDeep,
    borderWidth: 4,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    shadowColor: palette.pinkDeep,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  playNavIcon: {
    color: palette.white,
    fontSize: 15,
    fontWeight: '900',
  },
  playNavText: {
    color: palette.white,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 1,
  },
  screenRoot: {
    flex: 1,
    backgroundColor: palette.cream,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  lightString: {
    height: 34,
    marginHorizontal: -16,
    paddingHorizontal: 18,
    borderBottomWidth: 3,
    borderBottomColor: '#F5BAD1',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  lightBulb: {
    width: 14,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: palette.white,
    marginBottom: -10,
  },
  carnivalHeader: {
    alignItems: 'center',
    paddingTop: 26,
    paddingHorizontal: 10,
  },
  kicker: {
    color: palette.pinkDeep,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.cocoa,
    fontSize: 38,
    fontWeight: '900',
    textAlign: 'center',
  },
  homeSubtitle: {
    color: '#8C6674',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 330,
    marginTop: 6,
  },
  topStats: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 16,
  },
  pill: {
    minWidth: 92,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: palette.white,
    shadowColor: palette.softShadow,
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  pillLabel: {
    color: '#7C5A69',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  pillValue: {
    color: palette.cocoa,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 2,
  },
  houseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 24,
    gap: 14,
  },
  houseFloat: {
    flex: 1,
  },
  houseTapArea: {
    alignItems: 'center',
  },
  houseRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 64,
    borderRightWidth: 64,
    borderBottomWidth: 58,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  houseBody: {
    width: '100%',
    minHeight: 174,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: palette.white,
    marginTop: -2,
    alignItems: 'center',
    paddingTop: 18,
    paddingHorizontal: 10,
    shadowColor: palette.softShadow,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  houseWindowRow: {
    flexDirection: 'row',
    gap: 10,
  },
  houseWindow: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: palette.white,
  },
  houseDoor: {
    width: 42,
    height: 58,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 3,
    borderColor: palette.white,
    marginTop: 12,
  },
  houseTitle: {
    color: palette.cocoa,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 9,
  },
  houseSubtitle: {
    color: '#8C6674',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  stallRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  candyStall: {
    flex: 1,
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: '#FFF0B8',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decorStall: {
    flex: 1,
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: '#E5DCFF',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stallAwning: {
    color: palette.cocoa,
    fontWeight: '900',
    fontSize: 13,
    marginBottom: 8,
  },
  candyRow: {
    flexDirection: 'row',
    gap: 9,
  },
  candyDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: palette.white,
  },
  bowShape: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bowWing: {
    width: 28,
    height: 24,
    borderRadius: 14,
    backgroundColor: palette.pink,
    borderWidth: 2,
    borderColor: palette.white,
  },
  bowKnot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.pinkDeep,
    marginHorizontal: -2,
    zIndex: 2,
  },
  floatingButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
  },
  cuteButton: {
    minWidth: 98,
    borderRadius: 22,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 3,
    borderColor: palette.white,
    shadowColor: palette.softShadow,
    shadowOpacity: 0.3,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  wideButton: {
    width: '100%',
    marginTop: 10,
  },
  cuteButtonText: {
    color: palette.white,
    fontWeight: '900',
    fontSize: 14,
    textAlign: 'center',
  },
  floatShape: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  floatShapeLabel: {
    color: palette.white,
    fontWeight: '900',
    fontSize: 18,
  },
  balloonLeft: {
    top: 86,
    left: 18,
  },
  balloonRight: {
    top: 150,
    right: 18,
    width: 42,
    height: 62,
    borderRadius: 23,
  },
  starRight: {
    top: 82,
    right: 38,
    width: 40,
    height: 40,
    borderRadius: 8,
    transform: [{ rotate: '12deg' }],
  },
  starLeft: {
    top: 214,
    left: 22,
    width: 34,
    height: 34,
    borderRadius: 8,
    transform: [{ rotate: '-18deg' }],
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 8,
  },
  backButton: {
    borderRadius: 18,
    backgroundColor: palette.white,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: palette.pink,
  },
  backButtonText: {
    color: palette.cocoa,
    fontWeight: '900',
  },
  headerTitle: {
    flex: 1,
    color: palette.cocoa,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  headerStats: {
    alignItems: 'flex-end',
  },
  headerStatText: {
    color: '#8C6674',
    fontWeight: '900',
    fontSize: 12,
  },
  puzzleScroll: {
    backgroundColor: palette.cream,
    paddingHorizontal: 16,
    paddingBottom: 26,
  },
  levelBanner: {
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: '#FFE0EB',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: palette.cocoa,
    fontSize: 22,
    fontWeight: '900',
  },
  movesBadge: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: palette.lavender,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  movesNumber: {
    color: palette.cocoa,
    fontSize: 24,
    fontWeight: '900',
  },
  movesLabel: {
    color: '#7C5A69',
    fontSize: 11,
    fontWeight: '900',
  },
  woolPuzzleCard: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#FFFDF7',
    borderWidth: 4,
    borderColor: palette.white,
    padding: 12,
    shadowColor: palette.softShadow,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  woolPuzzleHeader: {
    alignItems: 'center',
  },
  woolPuzzleKicker: {
    color: palette.pinkDeep,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  woolPuzzleTitle: {
    color: palette.cocoa,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 3,
  },
  woolPuzzleNote: {
    color: '#8C6674',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 3,
  },
  woolStage: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#EAF8FF',
    borderWidth: 3,
    borderColor: '#D7F2FF',
    minHeight: 224,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  yarnCatBody: {
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: '#36AEEB',
    borderWidth: 5,
    borderColor: '#E7F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1B75AD',
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  yarnStroke: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 5,
    borderRadius: 5,
    backgroundColor: palette.white,
    transform: [{ rotate: '-8deg' }],
  },
  yarnCatEarLeft: {
    position: 'absolute',
    top: -12,
    left: 25,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#36AEEB',
    borderWidth: 5,
    borderColor: '#E7F8FF',
    transform: [{ rotate: '-28deg' }],
  },
  yarnCatEarRight: {
    position: 'absolute',
    top: -12,
    right: 25,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#36AEEB',
    borderWidth: 5,
    borderColor: '#E7F8FF',
    transform: [{ rotate: '28deg' }],
  },
  yarnCatFace: {
    width: 116,
    height: 104,
    borderRadius: 52,
    backgroundColor: palette.white,
    alignItems: 'center',
    paddingTop: 18,
  },
  yarnEyeRow: {
    flexDirection: 'row',
    gap: 18,
  },
  yarnEye: {
    width: 28,
    height: 34,
    borderRadius: 16,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: '#5F5663',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yarnPupil: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2F2A38',
  },
  yarnNose: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: palette.pinkDeep,
    borderWidth: 2,
    borderColor: palette.white,
    marginTop: 3,
  },
  yarnSmile: {
    width: 42,
    height: 20,
    borderBottomWidth: 3,
    borderBottomColor: palette.cocoa,
    borderRadius: 20,
    marginTop: 1,
  },
  yarnWhiskerLeft: {
    position: 'absolute',
    left: 10,
    top: 62,
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.cocoa,
    transform: [{ rotate: '8deg' }],
  },
  yarnWhiskerRight: {
    position: 'absolute',
    right: 10,
    top: 62,
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.cocoa,
    transform: [{ rotate: '-8deg' }],
  },
  yarnCollar: {
    position: 'absolute',
    bottom: 22,
    width: 86,
    height: 12,
    borderRadius: 7,
    backgroundColor: palette.pinkDeep,
    alignItems: 'center',
  },
  yarnBell: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.yellow,
    borderWidth: 3,
    borderColor: palette.white,
    marginTop: 4,
  },
  yarnCatFriendRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tinyYarnCat: {
    width: 44,
    height: 46,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tinyCatEar: {
    position: 'absolute',
    top: -13,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tinyCatEarLeft: {
    left: 4,
    transform: [{ rotate: '-18deg' }],
  },
  tinyCatEarRight: {
    right: 4,
    transform: [{ rotate: '18deg' }],
  },
  tinyCatEyeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  tinyCatEye: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.cocoa,
  },
  tinyCatBell: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.white,
    marginTop: 6,
  },
  puzzleBoard: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 22,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FFFDF7',
    borderWidth: 3,
    borderColor: palette.white,
    shadowColor: palette.softShadow,
    shadowOpacity: 0.25,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  woolMatchBoard: {
    backgroundColor: '#FFF9EF',
    borderRadius: 20,
    borderWidth: 4,
    borderColor: palette.white,
  },
  puzzleTile: {
    borderRadius: 8,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  woolPatchTile: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#B77891',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  woolTargetDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: palette.white,
  },
  woolPatchYarnLines: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 18,
    bottom: 18,
    justifyContent: 'space-around',
    opacity: 0.34,
  },
  woolPatchLine: {
    height: 5,
    borderRadius: 5,
    backgroundColor: palette.white,
    transform: [{ rotate: '-8deg' }],
  },
  woolPatchLineShort: {
    width: '68%',
    alignSelf: 'flex-end',
    transform: [{ rotate: '7deg' }],
  },
  woolPatchLabel: {
    color: palette.white,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    textShadowColor: 'rgba(108, 79, 95, 0.25)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 2 },
  },
  levelOneScroll: {
    backgroundColor: '#FFF7E8',
    paddingHorizontal: 12,
    paddingBottom: 28,
  },
  levelOneTopBar: {
    marginTop: 8,
    minHeight: 64,
    borderRadius: 22,
    backgroundColor: '#FFE4F0',
    borderWidth: 3,
    borderColor: palette.white,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: palette.softShadow,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  levelOneBackButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.pinkDeep,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelOneBackText: {
    color: palette.white,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '900',
  },
  levelOneKicker: {
    color: palette.pinkDeep,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  levelOneTitle: {
    color: palette.cocoa,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  levelOneLivesPill: {
    minWidth: 64,
    borderRadius: 17,
    backgroundColor: palette.white,
    borderWidth: 2,
    borderColor: palette.pink,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  levelOneLivesText: {
    color: palette.pinkDeep,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  levelOneTutorialCard: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: '#EAF8FF',
    borderWidth: 3,
    borderColor: palette.white,
    padding: 12,
    alignItems: 'center',
  },
  levelOneTutorialPrimary: {
    color: palette.cocoa,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  levelOneTutorialSecondary: {
    color: '#7C5A69',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  levelOneGoalPanel: {
    marginTop: 10,
    borderRadius: 18,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: '#FFE0EC',
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
  },
  yarnGoalPill: {
    minWidth: 104,
    borderRadius: 16,
    backgroundColor: '#FFF6E7',
    borderWidth: 2,
    borderColor: '#F2D1B6',
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  yarnGoalSwatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  yarnGoalText: {
    flex: 1,
    color: palette.cocoa,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  yarnGoalCount: {
    color: palette.pinkDeep,
    fontSize: 11,
    fontWeight: '900',
  },
  levelOneBoard: {
    alignSelf: 'center',
    marginTop: 12,
    borderRadius: 26,
    backgroundColor: '#DDF4FF',
    borderWidth: 4,
    borderColor: palette.white,
    overflow: 'hidden',
    shadowColor: '#88BFD8',
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  levelOneBoardGlow: {
    position: 'absolute',
    left: 70,
    right: 70,
    top: 112,
    bottom: 88,
    borderRadius: 90,
    backgroundColor: 'rgba(255, 255, 255, 0.56)',
  },
  levelOneRobot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 138,
    height: 150,
    marginLeft: -69,
    marginTop: -80,
    borderRadius: 70,
    backgroundColor: '#B8DFF3',
    borderWidth: 5,
    borderColor: '#EFFBFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4095C4',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
    zIndex: 2,
  },
  levelOneRobotComplete: {
    backgroundColor: '#36AEEB',
    borderColor: palette.yellow,
  },
  levelOneRobotEarLeft: {
    position: 'absolute',
    top: -13,
    left: 28,
    width: 37,
    height: 37,
    borderRadius: 10,
    backgroundColor: '#36AEEB',
    borderWidth: 4,
    borderColor: '#EFFBFF',
    transform: [{ rotate: '-24deg' }],
  },
  levelOneRobotEarRight: {
    position: 'absolute',
    top: -13,
    right: 28,
    width: 37,
    height: 37,
    borderRadius: 10,
    backgroundColor: '#36AEEB',
    borderWidth: 4,
    borderColor: '#EFFBFF',
    transform: [{ rotate: '24deg' }],
  },
  levelOneRobotFace: {
    width: 104,
    height: 88,
    borderRadius: 46,
    backgroundColor: palette.white,
    alignItems: 'center',
    paddingTop: 15,
  },
  levelOneRobotEyes: {
    flexDirection: 'row',
    gap: 15,
  },
  levelOneRobotEye: {
    width: 25,
    height: 30,
    borderRadius: 14,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: '#5F5663',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelOneRobotPupil: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2F2A38',
  },
  levelOneRobotNose: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: palette.pinkDeep,
    marginTop: 3,
  },
  levelOneRobotSmile: {
    width: 36,
    height: 17,
    borderBottomWidth: 3,
    borderBottomColor: palette.cocoa,
    borderRadius: 17,
  },
  levelOneRobotCollar: {
    position: 'absolute',
    bottom: 24,
    width: 78,
    height: 10,
    borderRadius: 6,
    backgroundColor: palette.pinkDeep,
    alignItems: 'center',
  },
  levelOneRobotBell: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: palette.yellow,
    borderWidth: 3,
    borderColor: palette.white,
    marginTop: 3,
  },
  levelOneYarnSlots: {
    position: 'absolute',
    bottom: 6,
    left: 18,
    right: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  levelOneYarnSlot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelOneRobotProgress: {
    position: 'absolute',
    bottom: -24,
    color: palette.cocoa,
    fontSize: 11,
    fontWeight: '900',
  },
  dottedGuideline: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1,
  },
  guidelineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(108, 79, 95, 0.38)',
  },
  levelOneTargetZone: {
    position: 'absolute',
    width: 74,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  levelOneTargetBlue: {
    left: 140,
    top: 116,
    backgroundColor: '#A9E6FF',
  },
  levelOneTargetWarm: {
    left: 135,
    top: 214,
    backgroundColor: '#FFD4B0',
  },
  levelOneTargetLight: {
    left: 95,
    top: 146,
    backgroundColor: '#F7F7FF',
  },
  levelOneTargetDark: {
    left: 58,
    top: 245,
    backgroundColor: '#D9D2DF',
  },
  levelOneTargetText: {
    color: palette.cocoa,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  levelOneCatTokenWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 4,
  },
  levelOneCatToken: {
    width: 58,
    height: 60,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6698AA',
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  levelOneCatEar: {
    position: 'absolute',
    top: -14,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  levelOneCatEarLeft: {
    left: 5,
    transform: [{ rotate: '-18deg' }],
  },
  levelOneCatEarRight: {
    right: 5,
    transform: [{ rotate: '18deg' }],
  },
  levelOneCatFace: {
    width: 42,
    height: 37,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    alignItems: 'center',
    paddingTop: 6,
  },
  darkCatFace: {
    backgroundColor: '#FFF7EA',
  },
  levelOneCatEyes: {
    flexDirection: 'row',
    gap: 8,
  },
  levelOneCatEye: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.cocoa,
  },
  levelOneCatArrow: {
    color: palette.cocoa,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '900',
  },
  darkCatArrow: {
    color: '#2F2A38',
  },
  levelOneMessage: {
    color: '#7C5A69',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 12,
  },
  helperText: {
    color: '#7C5A69',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
  },
  puzzleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    marginTop: 12,
  },
  previewRack: {
    marginTop: 16,
    borderRadius: 8,
    backgroundColor: '#F4EDFF',
    borderWidth: 3,
    borderColor: palette.white,
    padding: 12,
    alignItems: 'center',
  },
  previewTitle: {
    color: palette.cocoa,
    fontWeight: '900',
    fontSize: 15,
  },
  previewCopy: {
    color: '#7C5A69',
    fontWeight: '800',
    marginTop: 4,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sleeve: {
    position: 'absolute',
    width: 22,
    height: 25,
    borderRadius: 8,
    borderWidth: 2,
    transform: [{ rotate: '18deg' }],
  },
  shirtBody: {
    borderRadius: 8,
    borderWidth: 2,
  },
  skirtTop: {
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    marginBottom: -1,
  },
  skirtBody: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
  },
  dressTop: {
    width: 30,
    height: 28,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 2,
    marginBottom: -2,
  },
  dressBottom: {
    width: 0,
    height: 0,
    borderLeftWidth: 24,
    borderRightWidth: 24,
    borderBottomWidth: 38,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  jacketPanel: {
    position: 'absolute',
    width: 21,
    height: 48,
    borderRadius: 8,
    borderWidth: 2,
  },
  bagHandle: {
    width: 30,
    height: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 4,
    borderBottomWidth: 0,
    marginBottom: -5,
  },
  bagBody: {
    width: 48,
    height: 38,
    borderRadius: 10,
    borderWidth: 2,
  },
  shoe: {
    position: 'absolute',
    bottom: 18,
    width: 26,
    height: 18,
    borderTopLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 2,
  },
  scarfLoop: {
    width: 42,
    height: 32,
    borderRadius: 18,
    borderWidth: 7,
  },
  scarfTail: {
    position: 'absolute',
    bottom: 8,
    width: 12,
    height: 42,
    borderRadius: 7,
    borderWidth: 2,
  },
  hatTop: {
    width: 36,
    height: 30,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 2,
    marginBottom: -2,
  },
  hatBrim: {
    width: 58,
    height: 14,
    borderRadius: 10,
    borderWidth: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(108, 79, 95, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 8,
    backgroundColor: palette.cream,
    borderWidth: 4,
    borderColor: palette.white,
    padding: 18,
    alignItems: 'center',
  },
  rewardCard: {
    width: '100%',
    maxWidth: 370,
    borderRadius: 8,
    backgroundColor: '#FFF2F8',
    borderWidth: 4,
    borderColor: palette.white,
    padding: 18,
    alignItems: 'center',
  },
  modalTitle: {
    color: palette.cocoa,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalText: {
    color: '#7C5A69',
    textAlign: 'center',
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 8,
  },
  modalPlainButton: {
    padding: 12,
  },
  modalPlainText: {
    color: palette.cocoa,
    fontWeight: '900',
  },
  rewardName: {
    color: palette.cocoa,
    fontWeight: '900',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 8,
  },
  rewardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  customerCard: {
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: '#EAFBFF',
    borderWidth: 3,
    borderColor: palette.white,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  customerFace: {
    width: 82,
    height: 92,
    borderRadius: 32,
    backgroundColor: '#FFD5C2',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    overflow: 'hidden',
  },
  customerHair: {
    width: 86,
    height: 32,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    backgroundColor: '#8D6A7E',
  },
  customerEyeRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 18,
  },
  customerEye: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.cocoa,
  },
  customerSmile: {
    width: 24,
    height: 12,
    borderBottomWidth: 3,
    borderBottomColor: palette.cocoa,
    borderRadius: 12,
    marginTop: 10,
  },
  speechBubble: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: palette.white,
    padding: 12,
  },
  speechTitle: {
    color: palette.pinkDeep,
    fontWeight: '900',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  speechText: {
    color: palette.cocoa,
    fontWeight: '800',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 4,
  },
  boutiqueCounter: {
    marginTop: 14,
    alignItems: 'center',
  },
  emptyBoutique: {
    marginTop: 18,
    borderRadius: 8,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: palette.pink,
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: palette.cocoa,
    fontSize: 21,
    fontWeight: '900',
  },
  emptyText: {
    color: '#7C5A69',
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
  },
  rackGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 14,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  rackItem: {
    width: '47%',
    minHeight: 154,
    borderRadius: 8,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: '#FFE0EB',
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestedRackItem: {
    borderColor: palette.mintDeep,
    backgroundColor: '#F0FFF8',
  },
  soldRackItem: {
    opacity: 0.38,
  },
  itemName: {
    color: palette.cocoa,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 8,
  },
  itemMeta: {
    color: '#7C5A69',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  levelsRoot: {
    flex: 1,
    backgroundColor: '#75C9FF',
    overflow: 'hidden',
  },
  levelsBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  levelRainbow: {
    position: 'absolute',
    top: 205,
    left: -28,
    width: '118%',
    height: 190,
    borderTopWidth: 16,
    borderColor: 'rgba(255, 189, 218, 0.46)',
    borderRadius: 150,
  },
  levelCloud: {
    position: 'absolute',
    width: 112,
    height: 48,
  },
  levelCloudLeft: {
    top: 106,
    left: 10,
  },
  levelCloudRight: {
    top: 126,
    right: 0,
  },
  levelCloudCenter: {
    top: 78,
    left: '46%',
    opacity: 0.82,
  },
  levelCloudPuffLarge: {
    position: 'absolute',
    left: 28,
    top: 2,
    width: 58,
    height: 38,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  levelCloudPuffMedium: {
    position: 'absolute',
    left: 4,
    top: 18,
    width: 58,
    height: 28,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  levelCloudPuffSmall: {
    position: 'absolute',
    right: 0,
    top: 18,
    width: 64,
    height: 30,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  levelBalloonLeft: {
    top: 128,
    left: 72,
  },
  levelBalloonRight: {
    top: 118,
    right: 54,
  },
  levelCastle: {
    position: 'absolute',
    left: -2,
    top: 302,
    width: 104,
    height: 112,
    flexDirection: 'row',
    alignItems: 'flex-end',
    opacity: 0.96,
  },
  levelTowerSide: {
    width: 28,
    height: 78,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#D9B7FF',
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTowerRoof: {
    position: 'absolute',
    top: -27,
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderRightWidth: 18,
    borderBottomWidth: 30,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#9E78FF',
  },
  levelTowerRoofPink: {
    borderBottomColor: '#FF8FB3',
  },
  levelTowerWindow: {
    width: 11,
    height: 18,
    borderRadius: 6,
    backgroundColor: palette.yellow,
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelCastleBody: {
    width: 52,
    height: 96,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#F1CEFF',
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  levelCastleFlag: {
    position: 'absolute',
    top: -24,
    left: 21,
    width: 28,
    height: 18,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
    backgroundColor: palette.pinkDeep,
  },
  levelCastleDoor: {
    width: 24,
    height: 34,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    backgroundColor: '#8B66CF',
    borderWidth: 2,
    borderColor: palette.white,
    marginBottom: -2,
  },
  levelTreeLeft: {
    position: 'absolute',
    left: -36,
    bottom: 86,
    width: 126,
    height: 126,
    borderRadius: 63,
    backgroundColor: '#78D694',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  levelTreeRight: {
    position: 'absolute',
    right: -42,
    bottom: 222,
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: '#8CDF91',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  levelBunting: {
    position: 'absolute',
    top: 258,
    right: 4,
    width: 168,
    height: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    transform: [{ rotate: '8deg' }],
  },
  levelBuntingFlag: {
    width: 16,
    height: 22,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelFlower: {
    position: 'absolute',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelFlowerLeftOne: {
    left: 12,
    bottom: 78,
  },
  levelFlowerLeftTwo: {
    left: 78,
    bottom: 126,
  },
  levelFlowerRightOne: {
    right: 24,
    bottom: 168,
  },
  levelFlowerRightTwo: {
    right: 84,
    bottom: 110,
  },
  levelFlowerPetal: {
    position: 'absolute',
    width: 12,
    height: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.white,
  },
  levelFlowerCenter: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.yellow,
    borderWidth: 1,
    borderColor: palette.white,
  },
  levelsHud: {
    paddingHorizontal: 8,
    paddingTop: 8,
    zIndex: 5,
  },
  levelPlayerHud: {
    minHeight: 58,
    borderRadius: 24,
    backgroundColor: '#FF88A9',
    borderWidth: 3,
    borderColor: '#FFC8DA',
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#A94C72',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  levelProgressTrack: {
    width: 96,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#8D5376',
    borderWidth: 2,
    borderColor: '#FFD1DF',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  levelProgressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: palette.yellow,
  },
  levelProgressText: {
    color: palette.white,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  levelsHudResources: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 5,
  },
  levelHudPill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 21,
    backgroundColor: '#FFF0DA',
    borderWidth: 3,
    borderColor: '#F0B783',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    shadowColor: '#A77A50',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  levelHudIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  levelHudIconText: {
    color: palette.white,
    fontSize: 17,
    fontWeight: '900',
  },
  levelHudCopy: {
    flex: 1,
  },
  levelHudLabel: {
    color: '#7C4B60',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  levelHudValue: {
    color: '#5D2F44',
    fontSize: 13,
    fontWeight: '900',
  },
  levelHudDetail: {
    color: '#527092',
    fontSize: 8,
    fontWeight: '900',
  },
  levelHudPlus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#59D36F',
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelHudPlusText: {
    color: palette.white,
    fontSize: 17,
    lineHeight: 18,
    fontWeight: '900',
  },
  levelSettingsButton: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#B88BFF',
    borderWidth: 3,
    borderColor: '#E6D7FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7450B0',
    shadowOpacity: 0.32,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  levelSettingsText: {
    color: palette.white,
    fontSize: 10,
    fontWeight: '900',
  },
  levelsBackButton: {
    position: 'absolute',
    top: 132,
    left: 14,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: palette.pinkDeep,
    borderWidth: 4,
    borderColor: '#FFD8E4',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    shadowColor: '#C1567E',
    shadowOpacity: 0.34,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  levelsBackText: {
    color: palette.white,
    fontSize: 28,
    lineHeight: 31,
    fontWeight: '900',
  },
  levelsRibbon: {
    marginTop: 16,
    alignSelf: 'center',
    width: '70%',
    minHeight: 86,
    borderRadius: 22,
    backgroundColor: palette.pinkDeep,
    borderWidth: 4,
    borderColor: '#FFB9CC',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C1567E',
    shadowOpacity: 0.38,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
    zIndex: 4,
  },
  ribbonTailLeft: {
    position: 'absolute',
    left: -38,
    bottom: -5,
    width: 58,
    height: 45,
    backgroundColor: '#F35E8D',
    borderRadius: 10,
    transform: [{ rotate: '-15deg' }],
    borderWidth: 3,
    borderColor: '#FFB7D1',
  },
  ribbonTailRight: {
    position: 'absolute',
    right: -38,
    bottom: -5,
    width: 58,
    height: 45,
    backgroundColor: '#F35E8D',
    borderRadius: 10,
    transform: [{ rotate: '15deg' }],
    borderWidth: 3,
    borderColor: '#FFB7D1',
  },
  ribbonStarBadge: {
    position: 'absolute',
    left: 16,
    top: 10,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: palette.yellow,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-12deg' }],
  },
  ribbonStarText: {
    color: '#B87500',
    fontSize: 26,
    lineHeight: 29,
    fontWeight: '900',
  },
  ribbonBow: {
    position: 'absolute',
    right: 18,
    top: -24,
    flexDirection: 'row',
    alignItems: 'center',
    transform: [{ rotate: '-10deg' }],
  },
  ribbonBowWing: {
    width: 36,
    height: 30,
    borderRadius: 18,
    backgroundColor: '#B276F4',
    borderWidth: 3,
    borderColor: '#E7C9FF',
  },
  ribbonBowKnot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#9057D8',
    borderWidth: 2,
    borderColor: '#E7C9FF',
    marginHorizontal: -4,
    zIndex: 2,
  },
  ribbonButtonLeft: {
    position: 'absolute',
    left: 58,
    bottom: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.lilac,
    borderWidth: 3,
    borderColor: palette.white,
  },
  ribbonButtonRight: {
    position: 'absolute',
    right: 58,
    bottom: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.sky,
    borderWidth: 3,
    borderColor: palette.white,
  },
  levelsRibbonText: {
    color: palette.white,
    fontSize: 41,
    lineHeight: 45,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: '#B03463',
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 3 },
  },
  levelsScroll: {
    paddingTop: 18,
    paddingHorizontal: 10,
    paddingBottom: 116,
  },
  levelsGridPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 15,
    paddingTop: 10,
    paddingBottom: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 246, 225, 0.3)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.54)',
  },
  storyLevelBubble: {
    backgroundColor: '#FFF2E6',
    borderWidth: 2,
    borderColor: '#EDBE9E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#BE8A61',
    shadowOpacity: 0.22,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  storyLevelCatEar: {
    position: 'absolute',
    top: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 15,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  storyLevelCatEarLeft: {
    left: 6,
    transform: [{ rotate: '-18deg' }],
  },
  storyLevelCatEarRight: {
    right: 6,
    transform: [{ rotate: '18deg' }],
  },
  playedStoryLevel: {
    backgroundColor: '#FFF8EF',
  },
  bonusStoryLevel: {
    backgroundColor: '#F0D9FF',
    borderColor: '#D2A6FF',
  },
  currentStoryLevel: {
    backgroundColor: palette.pinkDeep,
    borderColor: palette.yellow,
    shadowOpacity: 0.42,
  },
  lockedStoryLevel: {
    backgroundColor: '#F2E8DF',
    borderColor: '#E1CFC4',
    opacity: 0.88,
  },
  storyLevelText: {
    color: '#B92354',
    fontSize: 17,
    fontWeight: '900',
  },
  tenthLevelText: {
    color: '#A756D9',
  },
  storyStarRow: {
    position: 'absolute',
    bottom: -10,
    flexDirection: 'row',
    gap: 0,
  },
  storyStar: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.yellow,
    borderWidth: 1,
    borderColor: '#B46B1D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyStarText: {
    color: '#B46B1D',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 10,
  },
  storyLockedLevelText: {
    position: 'absolute',
    bottom: 4,
    color: '#9C8790',
    fontSize: 7,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  levelsGarden: {
    marginTop: 12,
    minHeight: 244,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 236, 199, 0.66)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.78)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelsSign: {
    position: 'absolute',
    left: 10,
    bottom: 20,
    width: 138,
    borderRadius: 12,
    backgroundColor: '#FFE3EC',
    borderWidth: 3,
    borderColor: palette.white,
    padding: 10,
    transform: [{ rotate: '-4deg' }],
  },
  levelsSignLine: {
    color: '#B92354',
    fontWeight: '900',
    fontSize: 11,
    marginVertical: 3,
  },
  levelsCharacterGroup: {
    position: 'absolute',
    left: 136,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  levelBlueFriend: {
    width: 66,
    height: 76,
    borderRadius: 34,
    backgroundColor: '#209EEA',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2D83B9',
    shadowOpacity: 0.26,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  levelBlueFriendEarLeft: {
    position: 'absolute',
    top: -8,
    left: 8,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#209EEA',
  },
  levelBlueFriendEarRight: {
    position: 'absolute',
    top: -8,
    right: 8,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#209EEA',
  },
  levelBlueFriendFace: {
    width: 50,
    height: 45,
    borderRadius: 25,
    backgroundColor: palette.white,
    alignItems: 'center',
    paddingTop: 10,
  },
  levelBlueFriendEyes: {
    flexDirection: 'row',
    gap: 7,
  },
  levelBlueFriendEye: {
    width: 7,
    height: 10,
    borderRadius: 4,
    backgroundColor: '#24345C',
  },
  levelBlueFriendNose: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#F05A71',
    marginTop: 3,
  },
  levelBlueFriendSmile: {
    width: 20,
    height: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#51364A',
    borderRadius: 10,
  },
  levelBlueFriendCollar: {
    position: 'absolute',
    bottom: 11,
    width: 44,
    height: 8,
    borderRadius: 5,
    backgroundColor: '#F05A71',
    alignItems: 'center',
  },
  levelBlueFriendBell: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.yellow,
    borderWidth: 2,
    borderColor: palette.white,
    marginTop: 3,
  },
  levelTeddy: {
    width: 48,
    height: 50,
    borderRadius: 23,
    backgroundColor: '#EFB365',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTeddyEarLeft: {
    position: 'absolute',
    top: -7,
    left: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EFB365',
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelTeddyEarRight: {
    position: 'absolute',
    top: -7,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EFB365',
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelTeddyFace: {
    width: 22,
    height: 16,
    borderRadius: 10,
    backgroundColor: '#FFD8A5',
  },
  levelPuppy: {
    width: 42,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFD778',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelPuppyEar: {
    position: 'absolute',
    left: -4,
    top: 2,
    width: 18,
    height: 25,
    borderRadius: 9,
    backgroundColor: '#EFB365',
    transform: [{ rotate: '-20deg' }],
  },
  levelPuppyFace: {
    width: 17,
    height: 12,
    borderRadius: 8,
    backgroundColor: '#FFF0B8',
  },
  levelPuzzleHouseScene: {
    position: 'absolute',
    right: 8,
    bottom: 14,
    width: 112,
    height: 122,
    alignItems: 'center',
  },
  levelPuzzleHouseRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 56,
    borderRightWidth: 56,
    borderBottomWidth: 45,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FF82B0',
  },
  levelPuzzleHouseBody: {
    width: 104,
    height: 82,
    marginTop: -2,
    borderRadius: 14,
    backgroundColor: '#F6B778',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    paddingTop: 9,
  },
  levelPuzzleHouseWindow: {
    position: 'absolute',
    right: 12,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: palette.sky,
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelPuzzleHouseText: {
    color: palette.white,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '900',
    textAlign: 'center',
    backgroundColor: '#E94871',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
    transform: [{ rotate: '-2deg' }],
  },
  levelPuzzleHouseDoor: {
    position: 'absolute',
    bottom: -3,
    width: 30,
    height: 35,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    backgroundColor: '#7A5ECC',
    borderWidth: 2,
    borderColor: palette.white,
  },
  levelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
    paddingTop: 16,
    paddingBottom: 40,
  },
  levelBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E7DFEA',
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockedLevelBubble: {
    backgroundColor: palette.pink,
  },
  currentLevelBubble: {
    backgroundColor: palette.yellow,
    borderColor: palette.pinkDeep,
  },
  levelBubbleText: {
    color: palette.cocoa,
    fontWeight: '900',
  },
  lockedLevelText: {
    color: '#A99AAA',
  },
  settingsCard: {
    marginTop: 16,
    borderRadius: 8,
    backgroundColor: palette.white,
    borderWidth: 3,
    borderColor: palette.pink,
    padding: 16,
    alignItems: 'center',
  },
  settingsRows: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#FFF8FC',
    padding: 12,
    marginVertical: 12,
  },
  settingLine: {
    color: palette.cocoa,
    fontWeight: '800',
    marginVertical: 4,
  },
});
