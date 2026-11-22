/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  BlockColor,
  DifficultyModeId,
  DraggingPieceState,
  GridState,
  PieceShape,
  PlacementCoordinate,
} from './game/types';
import {
  COLOR_THEMES,
  DIFFICULTY_MODES,
  DIFFICULTY_ORDER,
  canPieceFitAnywhere,
  canPlacePiece,
  createEmptyGrid,
  getDifficultyConfig,
  getRandomPieces,
} from './game/shapes';
import {
  playClearSound,
  playGameOverSound,
  playPickSound,
  playPlaceSound,
  playRewardChimeSound,
  startBackgroundMusic,
  stopBackgroundMusic,
  setBackgroundMusicEnabled,
  setSoundVolume,
  setMusicVolume,
  playSoundVolumePreview,
  unlockAudioContext,
} from './game/audio';
import {
  triggerHaptic,
  triggerClearHaptic,
  setHapticsEnabled as syncHapticsEnabled,
} from './game/haptics';
import { HomeScreen } from './components/HomeScreen';
import { LeaderboardScreen } from './components/LeaderboardScreen';
import { NameSetupModal } from './components/NameSetupModal';
import { AudioSettingsModal } from './components/AudioSettingsModal';
import { ThemesModal, ThemesModalTab } from './components/ThemesModal';
import { ProgressionModal, ProgressionTab } from './components/ProgressionModal';
import { PlayerProfileModal } from './components/PlayerProfileModal';
import { FriendsModal } from './components/FriendsModal';
import { ScoreCard } from './components/ScoreCard';
import { BlockSkinOverlay } from './components/BlockSkinOverlay';
import { CosmeticPreviewModal } from './components/CosmeticPreviewModal';
import { ComboFlareOverlay, ComboFlareBurst } from './components/ComboFlareOverlay';
import { useOnlineStatus } from './hooks/usePWAInstall';
import type { User } from 'firebase/auth';
import {
  PlayerProfile,
  LeaderboardEntry,
  generateRandomName,
  mergeUserIntoLeaderboard,
  fetchSharedLeaderboardRecords,
  subscribeToLeaderboardRecords,
  getCachedRemoteRecords,
  getGuestPlayerId,
} from './game/leaderboard';
import {
  FirestoreLeaderboardRecord,
  getCurrentAuthUser,
  getLastFirestoreError,
  subscribeToAuthChanges,
  signInWithGoogle,
  signOutPlayer,
} from './game/firebase';
import {
  CloudAccountSnapshot,
  loadLegacyLocalSnapshot,
  loadLocalAccountSnapshot,
  saveLocalAccountSnapshot,
  syncAccountWithCloud,
} from './game/cloudSync';
import {
  RecordedGameRun,
  RecordedMove,
  RecordedShape,
  serializeShape,
  verifyGameRun,
} from './game/runVerifier';
import {
  FriendshipRecord,
  loadFriendships,
  listenToFriendships,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriendship,
} from './game/friends';
import {
  ThemeId,
  GAME_THEMES,
  getGameTheme,
  isThemeUnlocked,
} from './game/themes';
import {
  BlockSkinId,
  BLOCK_SKINS,
  isBlockSkinUnlocked,
} from './game/blockSkins';
import {
  PlayerStats,
  DailyChallengeDef,
  AchievementDef,
  loadPlayerStats,
  savePlayerStats,
  evaluateAchievements,
  getLevelInfo,
  getDailyChallenges,
  getTodayDateKey,
  createEmptyDailyProgress,
  createDefaultStats,
  formatDuration,
} from './game/progression';

export interface FlyingClearMessage {
  id: string;
  multiplier: number;
  points: number;
  accentColor: string;
}

export interface ToastNotice {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  badge?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function App() {
  // Navigation State: 'home' | 'game' | 'ranking'
  const [activeScreen, setActiveScreen] = useState<'home' | 'game' | 'ranking'>('home');
  const [previousScreen, setPreviousScreen] = useState<'home' | 'game'>('home');

  // Player Profile State (custom names have NO numbers; rolled names do)
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_player_profile');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    const random = generateRandomName();
    return {
      username: random.username,
      tag: random.tag,
      avatarLetter: random.username.charAt(0).toUpperCase(),
      hasChosenName: false,
    };
  });

  // Name setup modal state (opens on first visit if no name chosen yet)
  const [isNameModalOpen, setIsNameModalOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_player_profile');
      if (!saved) return true;
      try {
        const parsed = JSON.parse(saved);
        return !parsed.hasChosenName;
      } catch {
        return true;
      }
    }
    return false;
  });

  // Progression, XP, Achievements, Daily Challenges & Streak State
  const initialBootRef = useRef<ReturnType<typeof loadPlayerStats> | null>(null);
  if (!initialBootRef.current) {
    initialBootRef.current = loadPlayerStats();
  }
  const [playerStats, setPlayerStats] = useState<PlayerStats>(() => initialBootRef.current!.stats);
  const playerStatsRef = useRef<PlayerStats>(playerStats);
  playerStatsRef.current = playerStats;

  // Theme State (Starter + Achievement-Unlocked Themes)
  const [activeThemeId, setActiveThemeId] = useState<ThemeId>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_active_theme') as ThemeId | null;
      if (saved && saved in GAME_THEMES) {
        if (isThemeUnlocked(saved, initialBootRef.current!.stats.unlockedAchievements)) {
          return saved;
        }
      }
    }
    return 'cyber-neon';
  });
  const [previewThemeId, setPreviewThemeId] = useState<ThemeId | null>(null);
  const activeTheme = getGameTheme(activeThemeId);
  const displayTheme = activeTheme;

  // Cosmetic Block Skin State (Starter + 3/7/14-Day Streak Rewards)
  const [activeBlockSkinId, setActiveBlockSkinId] = useState<BlockSkinId>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_active_block_skin') as BlockSkinId | null;
      const bootStats = initialBootRef.current!.stats;
      const bestStreak = Math.max(bootStats.dailyStreak, bootStats.bestDailyStreak);
      if (
        saved &&
        saved in BLOCK_SKINS &&
        isBlockSkinUnlocked(saved, bestStreak, bootStats.unlockedBlockSkins)
      ) {
        return saved;
      }
    }
    return 'classic-gloss';
  });
  const [previewBlockSkinId, setPreviewBlockSkinId] = useState<BlockSkinId | null>(null);
  const displayBlockSkinId: BlockSkinId = activeBlockSkinId;
  const isPreviewingCosmetic = Boolean(previewThemeId || previewBlockSkinId);

  // Progression, Themes, Friends & Profile Modal States
  const [isThemesOpen, setIsThemesOpen] = useState<boolean>(false);
  const [themesModalTab, setThemesModalTab] = useState<ThemesModalTab>('themes');
  const [progressionModalTab, setProgressionModalTab] = useState<ProgressionTab | null>(null);
  const [isMyProfileOpen, setIsMyProfileOpen] = useState<boolean>(false);
  const [isFriendsOpen, setIsFriendsOpen] = useState<boolean>(false);
  const [selectedPlayerProfileId, setSelectedPlayerProfileId] = useState<string | null>(null);
  const [toastNotices, setToastNotices] = useState<ToastNotice[]>([]);

  // Authentication & Cloud Sync State (Firebase Auth + Firestore)
  const isNetworkOnline = useOnlineStatus();
  const [authUser, setAuthUser] = useState<User | null>(() => getCurrentAuthUser());
  const authUserRef = useRef<User | null>(authUser);
  authUserRef.current = authUser;
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [hasPendingSync, setHasPendingSync] = useState<boolean>(false);
  const hasPendingSyncRef = useRef<boolean>(false);
  hasPendingSyncRef.current = hasPendingSync;
  const preferencesUpdatedAtRef = useRef<number>(
    typeof window !== 'undefined' && localStorage.getItem('klick_player_profile') ? 1 : 0
  );

  // Friends & Global Players State (single authoritative cache updated via scoped listeners)
  const guestPlayerId = useMemo(() => getGuestPlayerId(), []);
  const currentPlayerId = authUser?.uid || guestPlayerId;
  const [friendships, setFriendships] = useState<FriendshipRecord[]>([]);
  const [remoteLeaderboardRecords, setRemoteLeaderboardRecords] = useState<
    FirestoreLeaderboardRecord[]
  >(() => getCachedRemoteRecords());

  // Session Playtime Tracking
  const [sessionElapsedSec, setSessionElapsedSec] = useState<number>(0);
  const sessionElapsedRef = useRef<number>(0);
  sessionElapsedRef.current = sessionElapsedSec;
  const hasPlacedInSessionRef = useRef<boolean>(false);
  const sessionFinalizedRef = useRef<boolean>(false);

  // Visual effects & Flying floating combo score messages
  const [flyingMessages, setFlyingMessages] = useState<FlyingClearMessage[]>([]);
  const [clearingRows, setClearingRows] = useState<number[]>([]);
  const [clearingCols, setClearingCols] = useState<number[]>([]);
  const [isBoardShaking, setIsBoardShaking] = useState<boolean>(false);
  const [comboFlareBurst, setComboFlareBurst] = useState<ComboFlareBurst | null>(null);
  const comboFlareTimeoutRef = useRef<number | null>(null);

  // Difficulty Mode & Board Size State
  const [difficultyMode, setDifficultyMode] = useState<DifficultyModeId>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('klick_difficulty_mode');
      const saved = (raw === 'chill' ? 'easy' : raw) as DifficultyModeId | null;
      if (saved && saved in DIFFICULTY_MODES) return saved;
    }
    return 'classic';
  });
  const [leaderboardMode, setLeaderboardMode] = useState<DifficultyModeId>(difficultyMode);
  const activeDifficulty = getDifficultyConfig(difficultyMode);
  const boardSize = activeDifficulty.boardSize;

  // Deterministic initial board + tray shared with the move verifier
  const initialBoardBootRef = useRef<{
    mode: DifficultyModeId;
    grid: GridState;
    tray: PieceShape[];
    runId: string;
    startedAt: number;
  } | null>(null);
  if (!initialBoardBootRef.current) {
    const raw =
      typeof window !== 'undefined'
        ? localStorage.getItem('klick_difficulty_mode')
        : null;
    const savedMode = (raw === 'chill' ? 'easy' : raw) as DifficultyModeId | null;
    const bootMode = savedMode && savedMode in DIFFICULTY_MODES ? savedMode : 'classic';
    const bootSize = getDifficultyConfig(bootMode).boardSize;
    const bootGrid = createEmptyGrid(bootSize);
    const bootTray = getRandomPieces(3, bootGrid, bootMode);
    initialBoardBootRef.current = {
      mode: bootMode,
      grid: bootGrid,
      tray: bootTray,
      runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
    };
  }

  // Move Recorder for deterministic score verification
  const runRecorderRef = useRef<{
    runId: string;
    mode: DifficultyModeId;
    startedAt: number;
    lastMoveAt: number;
    initialTray: RecordedShape[];
    moves: RecordedMove[];
  }>({
    runId: initialBoardBootRef.current.runId,
    mode: initialBoardBootRef.current.mode,
    startedAt: initialBoardBootRef.current.startedAt,
    lastMoveAt: initialBoardBootRef.current.startedAt,
    initialTray: initialBoardBootRef.current.tray.map(serializeShape),
    moves: [],
  });

  // Game Board State (Dynamic: 10x10, 8x8, 6x6, 4x4)
  const [grid, setGrid] = useState<GridState>(() => initialBoardBootRef.current!.grid);

  // Piece Tray State (3 slots)
  const [tray, setTray] = useState<(PieceShape | null)[]>(() => initialBoardBootRef.current!.tray);

  // Score & Stats
  const [score, setScore] = useState<number>(0);
  const [bestScore, setBestScore] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_best_score');
      return saved ? parseInt(saved, 10) || 0 : 0;
    }
    return 0;
  });
  const [modeBestScores, setModeBestScores] = useState<Record<DifficultyModeId, number>>(() => {
    const defaults: Record<DifficultyModeId, number> = {
      easy: 0,
      classic: 0,
      hard: 0,
      extreme: 0,
    };
    if (typeof window !== 'undefined') {
      const legacyClassic = parseInt(localStorage.getItem('klick_best_score') || '0', 10) || 0;
      const legacyChill = parseInt(localStorage.getItem('klick_best_score_chill') || '0', 10) || 0;
      defaults.classic = legacyClassic;
      defaults.easy = legacyChill;
      DIFFICULTY_ORDER.forEach((m) => {
        const val = parseInt(localStorage.getItem(`klick_best_score_${m}`) || '0', 10) || 0;
        defaults[m] = Math.max(defaults[m], val);
      });
    }
    return defaults;
  });
  const modeBestScore = modeBestScores[difficultyMode] || 0;
  const [combo, setCombo] = useState<number>(0);
  const [totalLinesCleared, setTotalLinesCleared] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [isNewRecord, setIsNewRecord] = useState<boolean>(false);

  const playerProfileRef = useRef<PlayerProfile>(playerProfile);
  playerProfileRef.current = playerProfile;
  const activeThemeIdRef = useRef<ThemeId>(activeThemeId);
  activeThemeIdRef.current = activeThemeId;
  const activeBlockSkinIdRef = useRef<BlockSkinId>(activeBlockSkinId);
  activeBlockSkinIdRef.current = activeBlockSkinId;
  const modeBestScoresRef = useRef<Record<DifficultyModeId, number>>(modeBestScores);
  modeBestScoresRef.current = modeBestScores;

  // Audio States (Independent Sound FX & Chill Background Music with Loudness Adjustments)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_sound_enabled');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_music_enabled');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [soundVolume, setSoundVolumeState] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_sound_volume');
      return saved !== null ? Math.max(0, Math.min(1, parseFloat(saved))) : 0.8;
    }
    return 0.8;
  });
  const [musicVolume, setMusicVolumeState] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_music_volume');
      return saved !== null ? Math.max(0, Math.min(1, parseFloat(saved))) : 0.8;
    }
    return 0.8;
  });
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState<boolean>(false);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('klick_haptics_enabled');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  // Synchronize initial audio volume levels, haptics & unlock audio on first user gesture
  useEffect(() => {
    setSoundVolume(soundVolume);
    setMusicVolume(musicVolume);
    syncHapticsEnabled(hapticsEnabled);

    const handleFirstUserInteraction = () => {
      unlockAudioContext();
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('keydown', handleFirstUserInteraction);
      window.removeEventListener('touchstart', handleFirstUserInteraction);
    };

    window.addEventListener('pointerdown', handleFirstUserInteraction, { passive: true });
    window.addEventListener('keydown', handleFirstUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleFirstUserInteraction, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('keydown', handleFirstUserInteraction);
      window.removeEventListener('touchstart', handleFirstUserInteraction);
    };
  }, []);

  const handleSoundVolumeChange = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setSoundVolumeState(clamped);
    setSoundVolume(clamped);
    if (clamped > 0 && !soundEnabled) {
      setSoundEnabled(true);
      try {
        localStorage.setItem('klick_sound_enabled', 'true');
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem('klick_sound_volume', clamped.toString());
    } catch {
      // ignore
    }
  }, [soundEnabled]);

  const handleMusicVolumeChange = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setMusicVolumeState(clamped);
    setMusicVolume(clamped);
    if (clamped > 0 && !musicEnabled) {
      setMusicEnabled(true);
      setBackgroundMusicEnabled(true);
      try {
        localStorage.setItem('klick_music_enabled', 'true');
      } catch {
        // ignore
      }
    }
    try {
      localStorage.setItem('klick_music_volume', clamped.toString());
    } catch {
      // ignore
    }
  }, [musicEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('klick_sound_enabled', next.toString());
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [clearingCells, setClearingCells] = useState<Set<string>>(new Set());

  // Dragging State
  const [dragging, setDragging] = useState<DraggingPieceState | null>(null);
  const [previewPlacement, setPreviewPlacement] = useState<PlacementCoordinate | null>(null);

  // References
  const boardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DraggingPieceState | null>(null);
  draggingRef.current = dragging;

  const gridRef = useRef<GridState>(grid);
  gridRef.current = grid;

  const trayRef = useRef<(PieceShape | null)[]>(tray);
  trayRef.current = tray;

  const lastPreviewRef = useRef<PlacementCoordinate | null>(null);

  const toastQueueRef = useRef<ToastNotice[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const notifiedQuestsRef = useRef<Set<string>>(new Set());

  const dismissToast = useCallback((id: string) => {
    const existingTimer = toastTimersRef.current.get(id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      toastTimersRef.current.delete(id);
    }

    setToastNotices((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length < 3 && toastQueueRef.current.length > 0) {
        const nextToast = toastQueueRef.current.shift()!;
        const timerId = window.setTimeout(() => {
          dismissToast(nextToast.id);
        }, 4400);
        toastTimersRef.current.set(nextToast.id, timerId);
        return [...remaining, nextToast];
      }
      return remaining;
    });
  }, []);

  const pushToast = useCallback(
    (
      title: string,
      subtitle: string,
      accent: string,
      options?: { badge?: string; actionLabel?: string; onAction?: () => void }
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const notice: ToastNotice = {
        id,
        title,
        subtitle,
        accent,
        badge: options?.badge,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      };

      setToastNotices((prev) => {
        if (prev.length >= 3) {
          toastQueueRef.current.push(notice);
          return prev;
        }
        const timerId = window.setTimeout(() => {
          dismissToast(id);
        }, 4400);
        toastTimersRef.current.set(id, timerId);
        return [...prev, notice];
      });
    },
    [dismissToast]
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const bestScoreRef = useRef<number>(bestScore);
  bestScoreRef.current = bestScore;
  const scoreRef = useRef<number>(score);
  scoreRef.current = score;

  const buildCurrentSnapshot = useCallback(
    (overrides?: Partial<CloudAccountSnapshot>): CloudAccountSnapshot => {
      const uid = authUserRef.current?.uid || 'guest';
      return {
        accountKey: uid,
        profile: overrides?.profile ?? playerProfileRef.current,
        stats: overrides?.stats ?? playerStatsRef.current,
        modeBestScores: overrides?.modeBestScores ?? modeBestScoresRef.current,
        bestScore: overrides?.bestScore ?? bestScoreRef.current,
        activeThemeId: overrides?.activeThemeId ?? activeThemeIdRef.current,
        activeBlockSkinId: overrides?.activeBlockSkinId ?? activeBlockSkinIdRef.current,
        preferencesUpdatedAt: overrides?.preferencesUpdatedAt ?? preferencesUpdatedAtRef.current,
        pendingSync: overrides?.pendingSync ?? hasPendingSyncRef.current,
      };
    },
    []
  );

  const applyAccountSnapshot = useCallback((snap: CloudAccountSnapshot) => {
    playerProfileRef.current = snap.profile;
    playerStatsRef.current = snap.stats;
    modeBestScoresRef.current = snap.modeBestScores;
    bestScoreRef.current = snap.bestScore;
    activeThemeIdRef.current = snap.activeThemeId;
    activeBlockSkinIdRef.current = snap.activeBlockSkinId;
    preferencesUpdatedAtRef.current = snap.preferencesUpdatedAt;
    hasPendingSyncRef.current = snap.pendingSync;

    setPlayerProfile(snap.profile);
    setPlayerStats(snap.stats);
    setModeBestScores(snap.modeBestScores);
    setBestScore(snap.bestScore);
    setActiveThemeId(snap.activeThemeId);
    setActiveBlockSkinId(snap.activeBlockSkinId);
    setHasPendingSync(snap.pendingSync);
    if (snap.profile.hasChosenName) {
      setIsNameModalOpen(false);
    }
  }, []);

  const persistSnapshotAndSync = useCallback(
    async (overrides?: Partial<CloudAccountSnapshot>, syncCloud = false): Promise<void> => {
      const uid = authUserRef.current?.uid || null;
      const snapshot = buildCurrentSnapshot({
        ...overrides,
        pendingSync: Boolean(uid && (syncCloud || hasPendingSyncRef.current)),
      });
      saveLocalAccountSnapshot(snapshot);
      if (!uid || !syncCloud) return;

      setIsSyncingCloud(true);
      try {
        const { merged, synced } = await syncAccountWithCloud(uid, snapshot);
        applyAccountSnapshot(merged);
        if (!synced) {
          setHasPendingSync(true);
        } else {
          setHasPendingSync(false);
        }
      } finally {
        setIsSyncingCloud(false);
      }
    },
    [buildCurrentSnapshot, applyAccountSnapshot]
  );

  const commitStatsUpdate = useCallback(
    (updater: (prev: PlayerStats) => PlayerStats, bestScoreOverride?: number): PlayerStats => {
      const prev = playerStatsRef.current;
      const prevLevel = getLevelInfo(prev.xp).level;
      const prevSkins = new Set(prev.unlockedBlockSkins || ['classic-gloss']);

      const updated = updater(prev);
      const effectiveBest = Math.max(bestScoreRef.current, bestScoreOverride || 0);
      const { nextStats, newlyUnlocked } = evaluateAchievements(updated, effectiveBest);
      playerStatsRef.current = nextStats;
      setPlayerStats(nextStats);
      savePlayerStats(nextStats);

      const todayKey = getTodayDateKey();
      const prevDaily = prev.dailyProgress.date === todayKey ? prev.dailyProgress : null;
      const nextDaily = nextStats.dailyProgress.date === todayKey ? nextStats.dailyProgress : null;
      const newlyCompletedQuests: DailyChallengeDef[] = [];

      if (nextDaily) {
        const challenges = getDailyChallenges(todayKey);
        challenges.forEach((ch) => {
          const questKey = `${todayKey}:${ch.id}`;
          if (
            nextDaily.claimedIds.includes(ch.id) ||
            notifiedQuestsRef.current.has(questKey)
          ) {
            return;
          }
          const prevVal = prevDaily ? prevDaily[ch.metric] || 0 : 0;
          const nextVal = nextDaily[ch.metric] || 0;
          if (nextVal >= ch.target && prevVal < ch.target) {
            notifiedQuestsRef.current.add(questKey);
            newlyCompletedQuests.push(ch);
          }
        });
      }

      const nextSkins = nextStats.unlockedBlockSkins || ['classic-gloss'];
      const newlyUnlockedSkins = nextSkins.filter((id) => !prevSkins.has(id));
      const nextLevelInfo = getLevelInfo(nextStats.xp);
      const leveledUp = nextLevelInfo.level > prevLevel;

      const hasCelebration =
        newlyCompletedQuests.length > 0 ||
        newlyUnlocked.length > 0 ||
        newlyUnlockedSkins.length > 0 ||
        leveledUp;

      if (hasCelebration) {
        triggerHaptic('clear', hapticsEnabled);
        playRewardChimeSound(soundEnabledRef.current);
      }

      newlyCompletedQuests.forEach((ch) => {
        pushToast(
          `🎯 QUEST FINISHED: ${ch.title.toUpperCase()}`,
          `Tap CLAIM to collect +${ch.xpReward} XP!`,
          '#34d399',
          {
            badge: 'QUEST READY',
            actionLabel: 'CLAIM',
            onAction: () => {
              setIsThemesOpen(false);
              setIsMyProfileOpen(false);
              setIsFriendsOpen(false);
              setSelectedPlayerProfileId(null);
              setProgressionModalTab('daily');
            },
          }
        );
      });

      newlyUnlocked.forEach((ach: AchievementDef) => {
        const rewardTheme = ach.unlockThemeId ? GAME_THEMES[ach.unlockThemeId] : null;
        pushToast(
          `${ach.badgeIcon} ${ach.name.toUpperCase()}`,
          `Achievement Unlocked • +${ach.xpReward} XP`,
          displayTheme.accentHex,
          {
            badge: 'ACHIEVEMENT',
            actionLabel: 'VIEW',
            onAction: () => {
              setIsThemesOpen(false);
              setProgressionModalTab('achievements');
            },
          }
        );
        if (rewardTheme) {
          pushToast(
            `🎨 NEW THEME: ${rewardTheme.name.toUpperCase()}`,
            `${rewardTheme.tagline} • Ready to equip!`,
            rewardTheme.accentHex,
            {
              badge: 'THEME UNLOCKED',
              actionLabel: 'EQUIP',
              onAction: () => {
                setProgressionModalTab(null);
                setIsMyProfileOpen(false);
                setIsFriendsOpen(false);
                setSelectedPlayerProfileId(null);
                setThemesModalTab('themes');
                setIsThemesOpen(true);
              },
            }
          );
        }
      });

      newlyUnlockedSkins.forEach((skinId) => {
        const skin = BLOCK_SKINS[skinId];
        if (!skin) return;
        pushToast(
          `${skin.badgeIcon} NEW SKIN: ${skin.name}`,
          `${skin.requiredStreakDays}-Day Streak Reward Unlocked!`,
          skin.accentHex,
          {
            badge: 'SKIN UNLOCKED',
            actionLabel: 'EQUIP',
            onAction: () => {
              setProgressionModalTab(null);
              setIsMyProfileOpen(false);
              setThemesModalTab('skins');
              setIsThemesOpen(true);
            },
          }
        );
      });

      if (leveledUp) {
        pushToast(
          `⭐ LEVEL ${nextLevelInfo.level} REACHED!`,
          `Rank promoted to ${nextLevelInfo.rankTitle.toUpperCase()}`,
          '#f6c445',
          {
            badge: 'LEVEL UP',
            actionLabel: 'PROFILE',
            onAction: () => {
              setProgressionModalTab(null);
              setIsThemesOpen(false);
              setIsMyProfileOpen(true);
            },
          }
        );
      }

      return nextStats;
    },
    [hapticsEnabled, pushToast, displayTheme.accentHex]
  );

  // Daily Streak Welcome Toast + Skin Unlock Celebration (no boot cloud overwrite!)
  useEffect(() => {
    const boot = initialBootRef.current;
    if (boot?.newDayCheckIn) {
      pushToast(
        `🔥 ${boot.stats.dailyStreak}-DAY STREAK!`,
        `Daily check-in reward: +${boot.streakRewardXp} XP`,
        '#fbbf24',
        {
          badge: 'DAILY CHECK-IN',
          actionLabel: 'DAILY',
          onAction: () => setProgressionModalTab('daily'),
        }
      );
    }
    if (boot?.newlyUnlockedSkins && boot.newlyUnlockedSkins.length > 0) {
      boot.newlyUnlockedSkins.forEach((skin) => {
        pushToast(
          `${skin.badgeIcon} NEW SKIN: ${skin.name}`,
          `${skin.requiredStreakDays}-Day Streak Reward Unlocked!`,
          skin.accentHex,
          {
            badge: 'SKIN UNLOCKED',
            actionLabel: 'EQUIP',
            onAction: () => {
              setThemesModalTab('skins');
              setIsThemesOpen(true);
            },
          }
        );
      });
    }
    const { nextStats, newlyUnlocked } = evaluateAchievements(
      playerStatsRef.current,
      bestScoreRef.current
    );
    if (nextStats.unlockedAchievements.length !== playerStatsRef.current.unlockedAchievements.length) {
      playerStatsRef.current = nextStats;
      setPlayerStats(nextStats);
      savePlayerStats(nextStats);
      newlyUnlocked.forEach((ach) => {
        const rewardTheme = ach.unlockThemeId ? GAME_THEMES[ach.unlockThemeId] : null;
        if (rewardTheme) {
          pushToast(
            `🎨 NEW THEME: ${rewardTheme.name.toUpperCase()}`,
            `Unlocked via ${ach.name} • Ready to equip!`,
            rewardTheme.accentHex,
            {
              badge: 'THEME UNLOCKED',
              actionLabel: 'EQUIP',
              onAction: () => {
                setThemesModalTab('themes');
                setIsThemesOpen(true);
              },
            }
          );
        }
      });
    }
  }, [pushToast]);

  // Auth lifecycle: pull cloud save BEFORE pushing, merge conflict-free, and flush offline pending syncs
  useEffect(() => {
    let cancelled = false;
    const unsubAuth = subscribeToAuthChanges(async (user) => {
      if (cancelled) return;
      authUserRef.current = user;
      setAuthUser(user);

      if (user) {
        setIsSyncingCloud(true);
        try {
          const cachedUserSnap = loadLocalAccountSnapshot(user.uid);
          const guestSnap =
            loadLocalAccountSnapshot('guest') ||
            (() => {
              const legacy = loadLegacyLocalSnapshot();
              return legacy ? { accountKey: 'guest', ...legacy, pendingSync: false } : null;
            })();

          const candidateLocal: CloudAccountSnapshot =
            cachedUserSnap ||
            (guestSnap
              ? { ...guestSnap, accountKey: user.uid, pendingSync: true }
              : buildCurrentSnapshot({ accountKey: user.uid, pendingSync: false }));

          const { merged, synced } = await syncAccountWithCloud(user.uid, candidateLocal);
          if (!cancelled) {
            applyAccountSnapshot(merged);
            setHasPendingSync(!synced);
          }
        } finally {
          if (!cancelled) setIsSyncingCloud(false);
        }
      } else {
        setFriendships([]);
        const guestSnap = loadLocalAccountSnapshot('guest');
        if (guestSnap) {
          applyAccountSnapshot(guestSnap);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, [applyAccountSnapshot, buildCurrentSnapshot]);

  // Flush queued offline sync automatically when network returns
  useEffect(() => {
    const flushIfNeeded = () => {
      const uid = authUserRef.current?.uid;
      if (!uid || !hasPendingSyncRef.current) return;
      persistSnapshotAndSync(undefined, true).catch(() => {});
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        flushIfNeeded();
      }
    };

    window.addEventListener('online', flushIfNeeded);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', flushIfNeeded);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [persistSnapshotAndSync]);

  // Active Gameplay Timer (ticks 1s locally — ZERO Firestore reads or writes on tick!)
  useEffect(() => {
    if (activeScreen !== 'game' || isPaused || isGameOver) return;

    const timer = window.setInterval(() => {
      const nextSession = sessionElapsedRef.current + 1;
      sessionElapsedRef.current = nextSession;
      setSessionElapsedSec(nextSession);

      commitStatsUpdate((prev) => ({
        ...prev,
        totalPlaytimeSec: prev.totalPlaytimeSec + 1,
        longestSessionSec: Math.max(prev.longestSessionSec, nextSession),
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeScreen, isPaused, isGameOver, commitStatsUpdate]);

  const handleSelectTheme = useCallback(
    (themeId: ThemeId) => {
      if (!isThemeUnlocked(themeId, playerStatsRef.current.unlockedAchievements)) return;
      triggerHaptic('tap', hapticsEnabled);
      setPreviewThemeId(null);
      setActiveThemeId(themeId);
      activeThemeIdRef.current = themeId;
      preferencesUpdatedAtRef.current = Date.now();
      persistSnapshotAndSync({ activeThemeId: themeId, preferencesUpdatedAt: preferencesUpdatedAtRef.current }, true).catch(() => {});
    },
    [hapticsEnabled, persistSnapshotAndSync]
  );

  const handlePreviewTheme = useCallback(
    (themeId: ThemeId) => {
      triggerHaptic('tap', hapticsEnabled);
      setPreviewBlockSkinId(null);
      setPreviewThemeId(themeId);
    },
    [hapticsEnabled]
  );

  const handleSelectBlockSkin = useCallback(
    (skinId: BlockSkinId) => {
      const stats = playerStatsRef.current;
      const bestStreak = Math.max(stats.dailyStreak, stats.bestDailyStreak);
      if (!isBlockSkinUnlocked(skinId, bestStreak, stats.unlockedBlockSkins)) return;
      triggerHaptic('tap', hapticsEnabled);
      setPreviewBlockSkinId(null);
      setActiveBlockSkinId(skinId);
      activeBlockSkinIdRef.current = skinId;
      preferencesUpdatedAtRef.current = Date.now();
      persistSnapshotAndSync({ activeBlockSkinId: skinId, preferencesUpdatedAt: preferencesUpdatedAtRef.current }, true).catch(() => {});
    },
    [hapticsEnabled, persistSnapshotAndSync]
  );

  const handlePreviewBlockSkin = useCallback(
    (skinId: BlockSkinId) => {
      triggerHaptic('tap', hapticsEnabled);
      setPreviewThemeId(null);
      setPreviewBlockSkinId(skinId);
    },
    [hapticsEnabled]
  );

  const handleCloseCosmeticPreview = useCallback(() => {
    triggerHaptic('tap', hapticsEnabled);
    setPreviewThemeId(null);
    setPreviewBlockSkinId(null);
  }, [hapticsEnabled]);

  const handleClaimDailyChallenge = useCallback(
    (challenge: DailyChallengeDef) => {
      const todayKey = getTodayDateKey();
      const prevDaily = playerStatsRef.current.dailyProgress;
      if (prevDaily.date === todayKey && prevDaily.claimedIds.includes(challenge.id)) return;

      triggerHaptic('clear', hapticsEnabled);
      playClearSound(2, 2, soundEnabled);

      const nextStats = commitStatsUpdate((prev) => {
        const daily =
          prev.dailyProgress.date === todayKey
            ? prev.dailyProgress
            : createEmptyDailyProgress(todayKey);
        if (daily.claimedIds.includes(challenge.id)) return prev;
        return {
          ...prev,
          xp: prev.xp + challenge.xpReward,
          totalQuestsClaimed: (prev.totalQuestsClaimed || 0) + 1,
          dailyProgress: {
            ...daily,
            claimedIds: [...daily.claimedIds, challenge.id],
          },
        };
      });

      pushToast(
        `⚡ MISSION COMPLETE`,
        `${challenge.title} • +${challenge.xpReward} XP`,
        displayTheme.accentHex
      );

      persistSnapshotAndSync({ stats: nextStats }, true).catch(() => {});
    },
    [hapticsEnabled, soundEnabled, commitStatsUpdate, pushToast, displayTheme.accentHex, persistSnapshotAndSync]
  );

  const unclaimedDailyCount = useMemo(() => {
    const todayKey = getTodayDateKey();
    const challenges = getDailyChallenges(todayKey);
    if (playerStats.dailyProgress.date !== todayKey) return 0;
    return challenges.filter((ch) => {
      const val = playerStats.dailyProgress[ch.metric] || 0;
      const done = val >= ch.target;
      const claimed = playerStats.dailyProgress.claimedIds.includes(ch.id);
      return done && !claimed;
    }).length;
  }, [playerStats]);

  const savePlayerProfile = (profile: PlayerProfile) => {
    setPlayerProfile(profile);
    playerProfileRef.current = profile;
    preferencesUpdatedAtRef.current = Date.now();
    setIsNameModalOpen(false);
    persistSnapshotAndSync(
      { profile, preferencesUpdatedAt: preferencesUpdatedAtRef.current },
      true
    ).catch(() => {});
  };

  const handleSignInGoogle = useCallback(async () => {
    triggerHaptic('tap', hapticsEnabled);
    try {
      await signInWithGoogle();
      pushToast(
        'CLOUD ACCOUNT LINKED',
        'Profile, achievements, streaks & friends synced!',
        '#34d399'
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || '';
      const message = err instanceof Error ? err.message : 'Google Sign-In could not complete.';
      if (code === 'auth/popup-closed-by-user' || message.includes('popup-closed-by-user')) {
        return;
      }
      if (code === 'auth/popup-blocked') {
        pushToast('POPUP BLOCKED', 'Allow popups for this site and tap Sign In again.', '#fbbf24');
      } else if (code === 'auth/unauthorized-domain') {
        pushToast('DOMAIN NOT AUTHORIZED', 'Add this app domain in Firebase Auth settings.', '#fb7185');
      } else {
        pushToast('SIGN-IN NOTICE', 'Could not complete Google Sign-In. Please try again.', '#fbbf24');
      }
    }
  }, [hapticsEnabled, pushToast]);

  const handleSignOut = useCallback(async () => {
    triggerHaptic('tap', hapticsEnabled);
    await persistSnapshotAndSync(undefined, true).catch(() => {});
    await signOutPlayer();
    setIsMyProfileOpen(false);
    setIsFriendsOpen(false);
    setFriendships([]);
    const guestDefaults: CloudAccountSnapshot = loadLocalAccountSnapshot('guest') || {
      accountKey: 'guest',
      profile: playerProfileRef.current,
      stats: createDefaultStats(),
      modeBestScores: { easy: 0, classic: 0, hard: 0, extreme: 0 },
      bestScore: 0,
      activeThemeId: 'cyber-neon',
      activeBlockSkinId: 'classic-gloss',
      preferencesUpdatedAt: 0,
      pendingSync: false,
    };
    applyAccountSnapshot(guestDefaults);
    pushToast('SIGNED OUT', 'Switched to local guest session.', '#94a3b8');
  }, [hapticsEnabled, persistSnapshotAndSync, applyAccountSnapshot, pushToast]);

  // Toggle Background Music
  const toggleMusic = useCallback(() => {
    setMusicEnabled((prev) => {
      const next = !prev;
      setBackgroundMusicEnabled(next);
      try {
        localStorage.setItem('klick_music_enabled', next.toString());
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Toggle Mobile Haptic Feedback
  const toggleHaptics = useCallback(() => {
    setHapticsEnabled((prev) => {
      const next = !prev;
      syncHapticsEnabled(next);
      if (next) {
        triggerHaptic('pick', true);
      }
      try {
        localStorage.setItem('klick_haptics_enabled', next.toString());
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Update live UI high-score badges locally during a run (cloud sync waits for verified finalizeCurrentRun)
  useEffect(() => {
    if (score > modeBestScore) {
      setModeBestScores((prev) => {
        const next = { ...prev, [difficultyMode]: score };
        modeBestScoresRef.current = next;
        return next;
      });
      setIsNewRecord(true);
      try {
        localStorage.setItem(`klick_best_score_${difficultyMode}`, score.toString());
      } catch {
        // Ignore
      }
    }

    if (score > bestScore) {
      setBestScore(score);
      bestScoreRef.current = score;
      try {
        localStorage.setItem('klick_best_score', score.toString());
      } catch {
        // Ignore
      }
    }
  }, [score, bestScore, modeBestScore, difficultyMode]);

  // One-time cached leaderboard fetch on mount (respects 60s TTL; zero per-second churn)
  const activeLeaderboardFetchMode = activeScreen === 'ranking' ? leaderboardMode : undefined;

  const refreshLeaderboardFromFirestore = useCallback(async () => {
    if (authUserRef.current?.uid && hasPendingSyncRef.current) {
      await persistSnapshotAndSync(undefined, true).catch(() => {});
      if (hasPendingSyncRef.current && getLastFirestoreError()) {
        pushToast(
          'SYNC DELAYED',
          'Your score is saved locally and will retry automatically.',
          '#fbbf24'
        );
      }
    }
    const records = await fetchSharedLeaderboardRecords(true, 100, activeLeaderboardFetchMode);
    setRemoteLeaderboardRecords(records);
  }, [activeLeaderboardFetchMode, persistSnapshotAndSync, pushToast]);

  useEffect(() => {
    fetchSharedLeaderboardRecords(false, 100)
      .then((records) => {
        if (records.length > 0) setRemoteLeaderboardRecords(records);
      })
      .catch(() => {});
  }, []);

  // Attach real-time leaderboard listener ONLY while social screens/modals are open
  const isLeaderboardListenerActive =
    activeScreen === 'ranking' || isFriendsOpen || selectedPlayerProfileId !== null;

  useEffect(() => {
    if (!isLeaderboardListenerActive) return;
    const unsub = subscribeToLeaderboardRecords(
      (records) => {
        setRemoteLeaderboardRecords(records);
      },
      100,
      activeLeaderboardFetchMode
    );
    return () => {
      unsub();
    };
  }, [isLeaderboardListenerActive, activeLeaderboardFetchMode]);

  // Overall leaderboard (used for Friends & player lookups across all grids)
  const { list: allPlayers, userEntry: overallUserEntry } = useMemo(
    () =>
      mergeUserIntoLeaderboard(
        remoteLeaderboardRecords,
        playerProfile,
        bestScore,
        playerStats,
        activeThemeId,
        currentPlayerId,
        undefined,
        modeBestScores
      ),
    [
      remoteLeaderboardRecords,
      playerProfile,
      bestScore,
      playerStats,
      activeThemeId,
      currentPlayerId,
      modeBestScores,
    ]
  );

  // Active gameplay/home grid ranking (so Home & Gameplay HUD #rank matches selected board)
  const { userRank } = useMemo(
    () =>
      mergeUserIntoLeaderboard(
        remoteLeaderboardRecords,
        playerProfile,
        bestScore,
        playerStats,
        activeThemeId,
        currentPlayerId,
        difficultyMode,
        modeBestScores
      ),
    [
      remoteLeaderboardRecords,
      playerProfile,
      bestScore,
      playerStats,
      activeThemeId,
      currentPlayerId,
      difficultyMode,
      modeBestScores,
    ]
  );

  // Selected Leaderboard Screen tab ranking (10x10 / 8x8 / 6x6 / 4x4)
  const {
    list: rankingPlayers,
    userRank: rankingUserRank,
    userEntry: rankingUserEntry,
  } = useMemo(
    () =>
      mergeUserIntoLeaderboard(
        remoteLeaderboardRecords,
        playerProfile,
        bestScore,
        playerStats,
        activeThemeId,
        currentPlayerId,
        leaderboardMode,
        modeBestScores
      ),
    [
      remoteLeaderboardRecords,
      playerProfile,
      bestScore,
      playerStats,
      activeThemeId,
      currentPlayerId,
      leaderboardMode,
      modeBestScores,
    ]
  );

  // Scoped real-time friendships sync — strictly gated on authenticated Firebase UID
  const refreshFriendshipsList = useCallback(() => {
    if (!authUserRef.current?.uid) return;
    loadFriendships(authUserRef.current.uid)
      .then((list) => setFriendships(list))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authUser?.uid) {
      setFriendships([]);
      return;
    }
    const unsub = listenToFriendships(authUser.uid, (list) => {
      setFriendships(list);
    });
    return () => {
      unsub();
    };
  }, [authUser?.uid]);

  const acceptedFriendCount = useMemo(
    () => friendships.filter((f) => f.status === 'accepted').length,
    [friendships]
  );

  const incomingFriendRequestsCount = useMemo(
    () =>
      friendships.filter(
        (f) => f.status === 'pending' && f.toId === currentPlayerId
      ).length,
    [friendships, currentPlayerId]
  );

  const handleSendFriendRequest = useCallback(
    async (target: LeaderboardEntry) => {
      if (!authUserRef.current?.uid) {
        pushToast('SIGN IN REQUIRED', 'Sign in with Google to add friends.', '#fbbf24');
        return;
      }
      if (target.isBenchmark || target.id.startsWith('bot_')) return;
      triggerHaptic('tap', hapticsEnabled);
      const ok = await sendFriendRequest(
        authUserRef.current.uid,
        playerProfileRef.current.username,
        target.id,
        target.username
      );
      refreshFriendshipsList();
      if (ok) {
        pushToast(
          'FRIEND REQUEST SENT',
          `Waiting for ${target.username} to accept`,
          displayTheme.accentHex
        );
      } else {
        pushToast(
          'REQUEST FAILED',
          'Could not reach server. Try again.',
          '#fb7185'
        );
      }
    },
    [hapticsEnabled, refreshFriendshipsList, pushToast, displayTheme.accentHex]
  );

  const handleAcceptFriendRequest = useCallback(
    async (friendshipId: string) => {
      triggerHaptic('clear', hapticsEnabled);
      const ok = await respondToFriendRequest(friendshipId, 'accepted');
      refreshFriendshipsList();
      if (ok) {
        pushToast(
          'FRIEND ADDED',
          'You are now connected on Klick!',
          '#34d399'
        );
      }
    },
    [hapticsEnabled, refreshFriendshipsList, pushToast]
  );

  const handleDeclineFriendRequest = useCallback(
    async (friendshipId: string) => {
      triggerHaptic('tap', hapticsEnabled);
      await respondToFriendRequest(friendshipId, 'declined');
      refreshFriendshipsList();
      pushToast('REQUEST DECLINED', 'Friend request dismissed', '#94a3b8');
    },
    [hapticsEnabled, refreshFriendshipsList, pushToast]
  );

  const handleRemoveFriendship = useCallback(
    async (friendshipId: string) => {
      triggerHaptic('tap', hapticsEnabled);
      await removeFriendship(friendshipId);
      refreshFriendshipsList();
      pushToast('UPDATED', 'Friend connection removed', '#94a3b8');
    },
    [hapticsEnabled, refreshFriendshipsList, pushToast]
  );

  const finalizeCurrentRun = useCallback(
    (isNaturalGameOver: boolean) => {
      if (!hasPlacedInSessionRef.current || sessionFinalizedRef.current) return;
      sessionFinalizedRef.current = true;

      const recordedRun: RecordedGameRun = {
        runId: runRecorderRef.current.runId,
        mode: runRecorderRef.current.mode,
        startedAt: runRecorderRef.current.startedAt,
        endedAt: Date.now(),
        claimedScore: scoreRef.current,
        initialTray: runRecorderRef.current.initialTray,
        moves: [...runRecorderRef.current.moves],
      };

      const localVerification = verifyGameRun(recordedRun);
      if (!localVerification.valid) {
        console.warn('Run verification rejected:', localVerification.reason);
        pushToast(
          'RUN NOT VERIFIED',
          'Only authentic gameplay scores are saved.',
          '#fb7185'
        );
        return;
      }

      const verifiedScore = localVerification.summary.verifiedScore;
      const runMode = localVerification.summary.mode;
      const todayKey = getTodayDateKey();
      const todayChallenges = getDailyChallenges(todayKey);
      const featuredChallenge = todayChallenges.find((c) => c.metric === 'featuredGamesToday');
      const isFeaturedMode =
        Boolean(featuredChallenge?.featuredMode) &&
        featuredChallenge?.featuredMode === runMode;

      const updatedModes: Record<DifficultyModeId, number> = {
        ...modeBestScoresRef.current,
        [runMode]: Math.max(modeBestScoresRef.current[runMode] || 0, verifiedScore),
      };
      const updatedBest = Math.max(bestScoreRef.current, ...Object.values(updatedModes));
      modeBestScoresRef.current = updatedModes;
      bestScoreRef.current = updatedBest;
      setModeBestScores(updatedModes);
      setBestScore(updatedBest);

      const nextStats = commitStatsUpdate((prev) => {
        const daily =
          prev.dailyProgress.date === todayKey
            ? prev.dailyProgress
            : createEmptyDailyProgress(todayKey);

        return {
          ...prev,
          xp: prev.xp + (isNaturalGameOver ? 20 : 0),
          gamesPlayed: prev.gamesPlayed + 1,
          dailyProgress: {
            ...daily,
            gamesToday: daily.gamesToday + 1,
            featuredGamesToday: daily.featuredGamesToday + (isFeaturedMode ? 1 : 0),
          },
        };
      }, verifiedScore);

      // Save locally right away; verify via backend when available before publishing to cloud
      const snapshotPayload: Partial<CloudAccountSnapshot> = {
        stats: nextStats,
        modeBestScores: updatedModes,
        bestScore: updatedBest,
      };

      (async () => {
        try {
          const res = await fetch('/api/runs/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(recordedRun),
          });
          if (res.status === 422) {
            pushToast(
              'RUN VERIFICATION FAILED',
              'Server rejected mismatched run replay.',
              '#fb7185'
            );
            return;
          }
        } catch {
          // Static hosting or offline: deterministic local replay already verified
        }
        await persistSnapshotAndSync(snapshotPayload, true);
      })().catch(() => {});
    },
    [commitStatsUpdate, persistSnapshotAndSync, pushToast]
  );

  // Restart / Reset game for active (or specified) difficulty mode
  const resetGame = useCallback(
    (targetMode?: DifficultyModeId) => {
      finalizeCurrentRun(false);
      triggerHaptic('tap', hapticsEnabled);
      const modeToUse = targetMode || difficultyMode;
      const cfg = getDifficultyConfig(modeToUse);
      const empty = createEmptyGrid(cfg.boardSize);
      const freshTray = getRandomPieces(3, empty, modeToUse);
      const now = Date.now();
      runRecorderRef.current = {
        runId: `run_${now}_${Math.random().toString(36).slice(2, 8)}`,
        mode: modeToUse,
        startedAt: now,
        lastMoveAt: now,
        initialTray: freshTray.map(serializeShape),
        moves: [],
      };
      gridRef.current = empty;
      trayRef.current = freshTray;
      draggingRef.current = null;
      setGrid(empty);
      setTray(freshTray);
      setScore(0);
      scoreRef.current = 0;
      setCombo(0);
      setTotalLinesCleared(0);
      setMaxCombo(0);
      setSessionElapsedSec(0);
      sessionElapsedRef.current = 0;
      hasPlacedInSessionRef.current = false;
      sessionFinalizedRef.current = false;
      setIsNewRecord(false);
      setIsGameOver(false);
      setIsPaused(false);
      setClearingCells(new Set());
      setClearingRows([]);
      setClearingCols([]);
      setComboFlareBurst(null);
      if (comboFlareTimeoutRef.current !== null) {
        window.clearTimeout(comboFlareTimeoutRef.current);
        comboFlareTimeoutRef.current = null;
      }
      setDragging(null);
      setPreviewPlacement(null);
      lastPreviewRef.current = null;
      setPreviewThemeId(null);
      setPreviewBlockSkinId(null);
    },
    [hapticsEnabled, difficultyMode, finalizeCurrentRun]
  );

  // Switch difficulty mode & board size cleanly
  const handleSelectDifficulty = useCallback(
    (newMode: DifficultyModeId) => {
      setLeaderboardMode(newMode);
      if (newMode === difficultyMode) {
        triggerHaptic('tap', hapticsEnabled);
        return;
      }
      setDifficultyMode(newMode);
      try {
        localStorage.setItem('klick_difficulty_mode', newMode);
      } catch {
        // Ignore
      }
      resetGame(newMode);
    },
    [difficultyMode, hapticsEnabled, resetGame]
  );

  const openLeaderboard = (from: 'home' | 'game') => {
    triggerHaptic('tap', hapticsEnabled);
    setPreviewThemeId(null);
    setPreviewBlockSkinId(null);
    setLeaderboardMode(difficultyMode);
    setPreviousScreen(from);
    setActiveScreen('ranking');
    if (authUserRef.current?.uid && hasPendingSyncRef.current) {
      persistSnapshotAndSync(undefined, true).catch(() => {});
    }
  };

  // Start game flow directly (auto-resets if the previous board had no moves left)
  const handleStartGame = () => {
    triggerHaptic('tap', hapticsEnabled);
    setPreviewThemeId(null);
    setPreviewBlockSkinId(null);
    const activePieces = trayRef.current.filter((p): p is PieceShape => p !== null);
    const hasMove =
      activePieces.length > 0 &&
      activePieces.some((p) => canPieceFitAnywhere(gridRef.current, p));
    if (isGameOver || !hasMove) {
      resetGame(difficultyMode);
    }
    if (musicEnabled) {
      startBackgroundMusic(true);
    }
    setActiveScreen('game');
  };

  /**
   * Measures the exact rendered pixel width and spacing of board squares
   * so dragging blocks match the board squares 1:1 with zero size mismatch.
   */
  const getBoardCellMetrics = useCallback(() => {
    const boardEl = boardRef.current;
    if (!boardEl) return { cellPx: 32, gapPx: 4, originLeft: 0, originTop: 0 };

    const firstCell = boardEl.querySelector('[data-r="0"][data-c="0"]') as HTMLElement | null;
    const secondCell = boardEl.querySelector('[data-r="0"][data-c="1"]') as HTMLElement | null;

    if (firstCell) {
      const rect = firstCell.getBoundingClientRect();
      const gapPx = secondCell ? secondCell.getBoundingClientRect().left - rect.right : 4;
      return {
        cellPx: rect.width,
        gapPx: Math.max(4, Math.round(gapPx)),
        originLeft: rect.left,
        originTop: rect.top,
      };
    }

    const rect = boardEl.getBoundingClientRect();
    const innerWidth = rect.width - 20; // 10px board padding
    const gapPx = 4;
    const cellPx = (innerWidth - (boardSize - 1) * gapPx) / boardSize;
    return {
      cellPx,
      gapPx,
      originLeft: rect.left + 10,
      originTop: rect.top + 10,
    };
  }, [boardSize]);

  // Shared visual center & grid metrics so floating block and drop target align 1:1
  const getFloatingPieceMetrics = useCallback(
    (pointerX: number, pointerY: number, piece: PieceShape, isTouch: boolean) => {
      const { cellPx, gapPx, originLeft, originTop } = getBoardCellMetrics();
      const effectiveGap = Math.max(4, gapPx);
      const stride = cellPx + effectiveGap;
      const rows = piece.matrix.length;
      const cols = piece.matrix[0].length;
      const pieceW = cols * cellPx + (cols - 1) * effectiveGap;
      const pieceH = rows * cellPx + (rows - 1) * effectiveGap;
      const halfW = pieceW / 2;
      const halfH = pieceH / 2;
      const touchOffset = isTouch ? 75 : 0;
      const targetY = pointerY - touchOffset;

      const centerX = Math.max(10 + halfW, Math.min(window.innerWidth - 10 - halfW, pointerX));
      const centerY = Math.max(10 + halfH, Math.min(window.innerHeight - 10 - halfH, targetY));

      return {
        centerX,
        centerY,
        cellPx,
        effectiveGap,
        stride,
        originLeft,
        originTop,
      };
    },
    [getBoardCellMetrics]
  );

  // Compute placement coordinate based on exact visual piece center
  const calculateTargetPlacement = useCallback(
    (
      pointerX: number,
      pointerY: number,
      piece: PieceShape,
      isTouch: boolean
    ): PlacementCoordinate | null => {
      const boardEl = boardRef.current;
      if (!boardEl) return null;

      const currentGrid = gridRef.current;
      const gridRows = currentGrid.length;
      const gridCols = currentGrid[0]?.length || gridRows;
      const pieceRows = piece.matrix.length;
      const pieceCols = piece.matrix[0].length;

      const { centerX, centerY, cellPx, stride, originLeft, originTop } =
        getFloatingPieceMetrics(pointerX, pointerY, piece, isTouch);

      // Map piece top-left block center directly to grid (r, c) coordinates
      const floatTargetC = (centerX - originLeft - cellPx / 2) / stride - (pieceCols - 1) / 2;
      const floatTargetR = (centerY - originTop - cellPx / 2) / stride - (pieceRows - 1) / 2;

      // Reject clearly off-board positions so pieces never auto-attach from the tray or outside
      if (
        floatTargetR < -0.45 ||
        floatTargetR > gridRows - pieceRows + 0.45 ||
        floatTargetC < -0.45 ||
        floatTargetC > gridCols - pieceCols + 0.45
      ) {
        return null;
      }

      const targetR = Math.round(floatTargetR);
      const targetC = Math.round(floatTargetC);

      if (canPlacePiece(currentGrid, piece, targetR, targetC)) {
        return { r: targetR, c: targetC };
      }

      // Tight seam-forgiveness snap only when straddling the boundary of an adjacent open spot
      let bestPlacement: PlacementCoordinate | null = null;
      let minDistance = Infinity;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const testR = targetR + dr;
          const testC = targetC + dc;
          if (canPlacePiece(currentGrid, piece, testR, testC)) {
            const distSq = (testR - floatTargetR) ** 2 + (testC - floatTargetC) ** 2;
            if (distSq < minDistance && distSq < 0.42) {
              minDistance = distSq;
              bestPlacement = { r: testR, c: testC };
            }
          }
        }
      }

      return bestPlacement;
    },
    [getFloatingPieceMetrics]
  );

  // Global Pointer Listeners for Smooth Drag and Drop
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const current = draggingRef.current;
      if (!current) return;
      if (current.pointerId !== undefined && e.pointerId !== current.pointerId) return;
      e.preventDefault();

      const moved =
        current.hasMoved ||
        Math.hypot(e.clientX - current.startX, e.clientY - current.startY) >= 8;

      const updatedDragging: DraggingPieceState = {
        ...current,
        pointerX: e.clientX,
        pointerY: e.clientY,
        hasMoved: moved,
      };
      draggingRef.current = updatedDragging;
      setDragging(updatedDragging);

      const placement = moved
        ? calculateTargetPlacement(e.clientX, e.clientY, current.piece, current.isTouch)
        : null;
      if (
        placement &&
        (!lastPreviewRef.current ||
          lastPreviewRef.current.r !== placement.r ||
          lastPreviewRef.current.c !== placement.c)
      ) {
        triggerHaptic('snap', hapticsEnabled);
      }
      lastPreviewRef.current = placement;
      setPreviewPlacement(placement);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const currentDragging = draggingRef.current;
      if (!currentDragging) return;
      if (
        currentDragging.pointerId !== undefined &&
        e.pointerId !== currentDragging.pointerId
      ) {
        return;
      }

      // Synchronously clear draggingRef so pointerup + pointercancel or rapid double-events can never replay a drop
      draggingRef.current = null;
      lastPreviewRef.current = null;
      setDragging(null);
      setPreviewPlacement(null);

      if (isGameOver || isPaused) return;

      const boardEl = boardRef.current;
      const placement = currentDragging.hasMoved
        ? calculateTargetPlacement(
            currentDragging.pointerX,
            currentDragging.pointerY,
            currentDragging.piece,
            currentDragging.isTouch
          )
        : null;

      if (boardEl && placement) {
        const { piece, trayIndex } = currentDragging;
        // Verify the tray slot still holds this piece and target cells are free
        if (!trayRef.current[trayIndex]) return;
        if (!canPlacePiece(gridRef.current, piece, placement.r, placement.c)) return;

        const targetR = placement.r;
        const targetC = placement.c;

        const newGrid = gridRef.current.map((row) => [...row]);
        const pieceRows = piece.matrix.length;
        const pieceCols = piece.matrix[0].length;
        let placedBlockCount = 0;

        for (let r = 0; r < pieceRows; r++) {
          for (let c = 0; c < pieceCols; c++) {
            if (piece.matrix[r][c] === 1) {
              newGrid[targetR + r][targetC + c] = piece.color;
              placedBlockCount++;
            }
          }
        }

        const nextTray = [...trayRef.current];
        nextTray[trayIndex] = null;

        const currentBoardSize = newGrid.length;

        const rowsToClear: number[] = [];
        for (let r = 0; r < currentBoardSize; r++) {
          if (newGrid[r].every((cell) => cell !== null)) {
            rowsToClear.push(r);
          }
        }

        const colsToClear: number[] = [];
        for (let c = 0; c < currentBoardSize; c++) {
          let full = true;
          for (let r = 0; r < currentBoardSize; r++) {
            if (newGrid[r][c] === null) {
              full = false;
              break;
            }
          }
          if (full) {
            colsToClear.push(c);
          }
        }

        const linesCleared = rowsToClear.length + colsToClear.length;
        const basePoints = placedBlockCount * 10;
        hasPlacedInSessionRef.current = true;
        let totalPointsGained = basePoints;
        let activeComboForMove = 0;

        if (linesCleared > 0) {
          const cellsMarked = new Set<string>();
          rowsToClear.forEach((r) => {
            for (let c = 0; c < currentBoardSize; c++) cellsMarked.add(`${r},${c}`);
          });
          colsToClear.forEach((c) => {
            for (let r = 0; r < currentBoardSize; r++) cellsMarked.add(`${r},${c}`);
          });

          setClearingCells(cellsMarked);
          setClearingRows(rowsToClear);
          setClearingCols(colsToClear);
          setIsBoardShaking(true);

          rowsToClear.forEach((r) => {
            for (let c = 0; c < currentBoardSize; c++) {
              newGrid[r][c] = null;
            }
          });
          colsToClear.forEach((c) => {
            for (let r = 0; r < currentBoardSize; r++) {
              newGrid[r][c] = null;
            }
          });

          const nextCombo = combo + 1;
          activeComboForMove = nextCombo;
          setCombo(nextCombo);
          setMaxCombo((prev) => Math.max(prev, nextCombo));
          setTotalLinesCleared((prev) => prev + linesCleared);

          // Consecutive Combo Multiplier: 1x, 1.5x, 2.0x, 2.5x, 3.0x, etc.
          const comboMultiplier = 1 + Math.max(0, nextCombo - 1) * 0.5;

          playClearSound(nextCombo, linesCleared, soundEnabled, comboMultiplier);
          triggerClearHaptic(linesCleared, nextCombo, hapticsEnabled);

          // Rich Multiplier Calculations:
          let baseLinePoints = 150;
          if (linesCleared === 2) {
            baseLinePoints = 450;
          } else if (linesCleared === 3) {
            baseLinePoints = 900;
          } else if (linesCleared >= 4) {
            baseLinePoints = 1600;
          }

          const clearScore = Math.round(baseLinePoints * comboMultiplier);
          totalPointsGained = basePoints + clearScore;

          setScore((prev) => prev + totalPointsGained);

          // Spawn Flying Message showing ONLY the multiplier (1x, 2x, 3x...) and points number
          const msgId = `${Date.now()}-${Math.random()}`;
          const currentMultiplier = Math.max(1, linesCleared, nextCombo);
          const newMsg: FlyingClearMessage = {
            id: msgId,
            multiplier: currentMultiplier,
            points: totalPointsGained,
            accentColor:
              currentMultiplier >= 3
                ? '#f43f5e'
                : currentMultiplier === 2
                ? '#f6c445'
                : activeTheme.accentHex,
          };

          setFlyingMessages((prev) => [...prev.slice(-2), newMsg]);
          setTimeout(() => {
            setFlyingMessages((prev) => prev.filter((m) => m.id !== msgId));
          }, 1400);

          setTimeout(() => {
            setClearingCells(new Set());
            setClearingRows([]);
            setClearingCols([]);
          }, 380);

          setTimeout(() => {
            setIsBoardShaking(false);
          }, 360);

          if (nextCombo >= 5) {
            const burstId = `flare-${Date.now()}-${nextCombo}`;
            setComboFlareBurst({
              id: burstId,
              combo: nextCombo,
              isInitialTierUnlock: nextCombo === 5,
              accentHex: activeTheme.accentHex,
            });
            if (comboFlareTimeoutRef.current !== null) {
              window.clearTimeout(comboFlareTimeoutRef.current);
            }
            comboFlareTimeoutRef.current = window.setTimeout(() => {
              setComboFlareBurst((prev) => (prev?.id === burstId ? null : prev));
              comboFlareTimeoutRef.current = null;
            }, 1450);
          }
        } else {
          setCombo(0);
          setScore((prev) => prev + basePoints);
          playPlaceSound(soundEnabled);
          triggerHaptic('place', hapticsEnabled);
        }

        // Update XP, achievement progress, and daily challenge stats
        const projectedRunScore = scoreRef.current + totalPointsGained;
        scoreRef.current = projectedRunScore;
        const xpGained =
          placedBlockCount * 2 +
          linesCleared * 20 +
          (activeComboForMove > 1 ? activeComboForMove * 12 : 0);
        const todayKey = getTodayDateKey();

        commitStatsUpdate((prev) => {
          const daily =
            prev.dailyProgress.date === todayKey
              ? prev.dailyProgress
              : createEmptyDailyProgress(todayKey);

          return {
            ...prev,
            xp: prev.xp + xpGained,
            totalBlocksPlaced: prev.totalBlocksPlaced + placedBlockCount,
            totalLinesCleared: prev.totalLinesCleared + linesCleared,
            bestCombo: Math.max(prev.bestCombo, activeComboForMove),
            bestSingleMoveLines: Math.max(prev.bestSingleMoveLines, linesCleared),
            extremeBestScore:
              difficultyMode === 'extreme'
                ? Math.max(prev.extremeBestScore, projectedRunScore)
                : prev.extremeBestScore,
            hardBestScore:
              difficultyMode === 'hard'
                ? Math.max(prev.hardBestScore, projectedRunScore)
                : prev.hardBestScore,
            dailyProgress: {
              ...daily,
              linesClearedToday: daily.linesClearedToday + linesCleared,
              blocksPlacedToday: (daily.blocksPlacedToday || 0) + placedBlockCount,
              bestScoreToday: Math.max(daily.bestScoreToday, projectedRunScore),
              bestComboToday: Math.max(daily.bestComboToday, activeComboForMove),
            },
          };
        }, projectedRunScore);

        // If tray is empty, spawn 3 new mode-compatible pieces that fit on the board
        const remainingPieces = nextTray.filter((p): p is PieceShape => p !== null);
        let finalTray = nextTray;
        let spawnedTray: RecordedShape[] | undefined;
        if (remainingPieces.length === 0) {
          finalTray = getRandomPieces(3, newGrid, difficultyMode);
          spawnedTray = finalTray
            .filter((p): p is PieceShape => p !== null)
            .map(serializeShape);
        }

        // Record deterministic move for run/score verification
        const now = Date.now();
        const dtMs = Math.max(0, now - runRecorderRef.current.lastMoveAt);
        runRecorderRef.current.lastMoveAt = now;
        runRecorderRef.current.moves.push({
          trayIndex,
          row: targetR,
          col: targetC,
          dtMs,
          ...(spawnedTray ? { spawnedTray } : {}),
        });

        // Sync refs immediately alongside React state so rapid moves never read stale grid/tray
        gridRef.current = newGrid;
        trayRef.current = finalTray;
        setGrid(newGrid);
        setTray(finalTray);

        // Check Game Over: Can ANY remaining piece fit on the board?
        const activePieces = finalTray.filter((p): p is PieceShape => p !== null);
        const hasValidMove = activePieces.some((p) => canPieceFitAnywhere(newGrid, p));

        if (!hasValidMove) {
          setIsGameOver(true);
          playGameOverSound(soundEnabled);
          setTimeout(() => triggerHaptic('gameOver', hapticsEnabled), 160);
          scoreRef.current = projectedRunScore;
          finalizeCurrentRun(true);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    calculateTargetPlacement,
    combo,
    soundEnabled,
    hapticsEnabled,
    difficultyMode,
    activeTheme.accentHex,
    commitStatsUpdate,
    finalizeCurrentRun,
    isGameOver,
    isPaused,
  ]);

  // Pointer Down on Tray Piece
  const handlePointerDownPiece = (
    e: React.PointerEvent<HTMLDivElement>,
    piece: PieceShape,
    trayIndex: number
  ) => {
    e.preventDefault();
    if (isGameOver || isPaused || isPreviewingCosmetic) return;

    playPickSound(soundEnabled);
    triggerHaptic('pick', hapticsEnabled);

    const nextDragging: DraggingPieceState = {
      piece,
      trayIndex,
      pointerId: e.pointerId,
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
      isTouch: e.pointerType === 'touch',
    };
    draggingRef.current = nextDragging;
    setDragging(nextDragging);

    lastPreviewRef.current = null;
    setPreviewPlacement(null);
  };

  // Check if a cell is part of preview placement
  const isPreviewCell = (r: number, c: number): boolean => {
    if (!previewPlacement || !dragging) return false;
    const { piece } = dragging;
    const relR = r - previewPlacement.r;
    const relC = c - previewPlacement.c;
    if (
      relR >= 0 &&
      relR < piece.matrix.length &&
      relC >= 0 &&
      relC < piece.matrix[0].length
    ) {
      return piece.matrix[relR][relC] === 1;
    }
    return false;
  };

  // Render static piece preview inside slot
  const renderMiniPiece = (piece: PieceShape) => {
    const theme = COLOR_THEMES[piece.color];
    const rows = piece.matrix.length;
    const cols = piece.matrix[0].length;

    let cellPx = 18;
    if (rows >= 5 || cols >= 5) cellPx = 10;
    else if (rows > 3 || cols > 3) cellPx = 13;
    else if (rows === 1 && cols === 1) cellPx = 24;

    return (
      <div
        className="grid gap-1 pointer-events-none select-none transition-transform"
        style={{
          gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
          gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
        }}
      >
        {piece.matrix.map((row, r) =>
          row.map((cell, c) => (
            <div
              key={`${r}-${c}`}
              className={`relative overflow-hidden rounded-[3px] transition-all ${
                cell === 1
                  ? `${theme.solid} ${theme.shadow} border ${theme.border}`
                  : 'bg-transparent'
              }`}
              style={{ width: `${cellPx}px`, height: `${cellPx}px` }}
            >
              {cell === 1 && <BlockSkinOverlay skinId={displayBlockSkinId} compact />}
            </div>
          ))
        )}
      </div>
    );
  };

  // Render dragging piece matching the board square size 1:1 and clamped >= 10px from screen border
  const renderFloatingDraggingPiece = () => {
    if (!dragging) return null;
    const { piece, pointerX, pointerY, isTouch } = dragging;
    const theme = COLOR_THEMES[piece.color];
    const rows = piece.matrix.length;
    const cols = piece.matrix[0].length;

    const { centerX, centerY, cellPx, effectiveGap } = getFloatingPieceMetrics(
      pointerX,
      pointerY,
      piece,
      isTouch
    );
    const cellRadius =
      boardSize <= 4
        ? 'rounded-lg'
        : boardSize >= 10
        ? 'rounded-[4px]'
        : 'rounded-[5px] sm:rounded-md';

    return (
      <div
        className="fixed pointer-events-none z-50 select-none -translate-x-1/2 -translate-y-1/2"
        style={{
          left: `${centerX}px`,
          top: `${centerY}px`,
        }}
      >
        <div
          className="grid filter drop-shadow-[0_8px_16px_rgba(0,0,0,0.85)] scale-100"
          style={{
            gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
            gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
            gap: `${effectiveGap}px`,
          }}
        >
          {piece.matrix.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={`drag-${r}-${c}`}
                className={`relative overflow-hidden ${cellRadius} transition-all ${
                  cell === 1
                    ? `${theme.solid} ${theme.shadow} border ${theme.border}`
                    : 'bg-transparent'
                }`}
                style={{ width: `${cellPx}px`, height: `${cellPx}px` }}
              >
                {cell === 1 && (
                  <BlockSkinOverlay
                    skinId={displayBlockSkinId}
                    compact={boardSize >= 10}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const selectedProfileEntry = useMemo(() => {
    if (isMyProfileOpen) return overallUserEntry;
    if (selectedPlayerProfileId) {
      return allPlayers.find((p) => p.id === selectedPlayerProfileId) || null;
    }
    return null;
  }, [isMyProfileOpen, overallUserEntry, selectedPlayerProfileId, allPlayers]);

  const playerLevelInfo = useMemo(() => getLevelInfo(playerStats.xp), [playerStats.xp]);

  // Combo Meter derived visuals
  const comboMultiplierValue = combo >= 2 ? 1 + (combo - 1) * 0.5 : 1;
  const comboMeterPercent = combo >= 1 ? Math.min(100, Math.round((combo / 5) * 100)) : 0;
  const comboTierInfo = useMemo(() => {
    if (combo >= 5) return { label: 'HYPERNOVA', color: '#f43f5e' };
    if (combo === 4) return { label: 'OVERDRIVE', color: '#fb7185' };
    if (combo === 3) return { label: 'BLAZING', color: '#f59e0b' };
    if (combo === 2) return { label: 'HOT STREAK', color: '#fbbf24' };
    if (combo === 1) return { label: 'PRIMED', color: displayTheme.accentHex };
    return { label: 'READY', color: '#64748b' };
  }, [combo, displayTheme.accentHex]);

  return (
    <div
      style={{ backgroundColor: displayTheme.outerBg }}
      className="w-full h-full text-slate-100 flex flex-col items-center justify-center select-none font-['Orbitron',sans-serif] overflow-hidden p-0 sm:p-2 touch-none transition-colors duration-300"
    >
      {/* Name & Profile Picture Modal */}
      <NameSetupModal
        isOpen={isNameModalOpen}
        currentProfile={playerProfile}
        activeTheme={displayTheme}
        onSave={savePlayerProfile}
        onClose={() => setIsNameModalOpen(false)}
        isInitialSetup={!playerProfile.hasChosenName}
        isSignedIn={Boolean(authUser)}
        onSignInGoogle={handleSignInGoogle}
      />

      {/* Audio Settings & Haptics Modal */}
      <AudioSettingsModal
        isOpen={isAudioSettingsOpen}
        soundEnabled={soundEnabled}
        musicEnabled={musicEnabled}
        hapticsEnabled={hapticsEnabled}
        soundVolume={soundVolume}
        musicVolume={musicVolume}
        activeTheme={displayTheme}
        onToggleSound={toggleSound}
        onToggleMusic={toggleMusic}
        onToggleHaptics={toggleHaptics}
        onChangeSoundVolume={handleSoundVolumeChange}
        onChangeMusicVolume={handleMusicVolumeChange}
        onClose={() => setIsAudioSettingsOpen(false)}
      />

      {/* Visual Themes & Block Skins Modal */}
      <ThemesModal
        isOpen={isThemesOpen}
        initialTab={themesModalTab}
        activeThemeId={activeThemeId}
        previewThemeId={previewThemeId}
        activeTheme={displayTheme}
        unlockedAchievements={playerStats.unlockedAchievements}
        activeBlockSkinId={activeBlockSkinId}
        previewBlockSkinId={previewBlockSkinId}
        bestDailyStreak={Math.max(playerStats.dailyStreak, playerStats.bestDailyStreak)}
        unlockedBlockSkins={playerStats.unlockedBlockSkins || ['classic-gloss']}
        onSelectTheme={handleSelectTheme}
        onPreviewTheme={handlePreviewTheme}
        onSelectBlockSkin={handleSelectBlockSkin}
        onPreviewBlockSkin={handlePreviewBlockSkin}
        onClose={() => {
          setIsThemesOpen(false);
          setPreviewThemeId(null);
          setPreviewBlockSkinId(null);
        }}
      />

      {/* Full-Size Gameplay-Look Cosmetic Preview Popup */}
      <CosmeticPreviewModal
        isOpen={isPreviewingCosmetic}
        previewTheme={previewThemeId ? getGameTheme(previewThemeId) : activeTheme}
        previewSkinId={previewBlockSkinId || activeBlockSkinId}
        previewLabel={
          previewThemeId
            ? `${getGameTheme(previewThemeId).name} THEME (LOCKED)`
            : previewBlockSkinId
            ? `${BLOCK_SKINS[previewBlockSkinId].name} SKIN (${BLOCK_SKINS[previewBlockSkinId].requiredStreakDays}D STREAK)`
            : ''
        }
        accentHex={
          previewBlockSkinId
            ? BLOCK_SKINS[previewBlockSkinId].accentHex
            : previewThemeId
            ? getGameTheme(previewThemeId).accentHex
            : activeTheme.accentHex
        }
        boardSize={boardSize}
        difficultyMode={difficultyMode}
        playerLevel={playerLevelInfo.level}
        modeBestScore={modeBestScore}
        userRank={userRank}
        onClose={handleCloseCosmeticPreview}
      />

      {/* Daily Challenges, Streak & Achievements Modal */}
      <ProgressionModal
        isOpen={progressionModalTab !== null}
        initialTab={progressionModalTab || 'daily'}
        playerStats={playerStats}
        bestScore={bestScore}
        activeTheme={displayTheme}
        onClaimChallenge={handleClaimDailyChallenge}
        onOpenThemes={() => {
          setProgressionModalTab(null);
          setThemesModalTab('themes');
          setIsThemesOpen(true);
        }}
        onOpenBlockSkins={() => {
          setProgressionModalTab(null);
          setThemesModalTab('skins');
          setIsThemesOpen(true);
        }}
        onClose={() => setProgressionModalTab(null)}
      />

      {/* Friends & Mutual Requests Modal */}
      <FriendsModal
        isOpen={isFriendsOpen}
        isSignedIn={Boolean(authUser)}
        currentPlayerId={currentPlayerId}
        allPlayers={allPlayers}
        friendships={friendships}
        activeTheme={displayTheme}
        onSignInGoogle={handleSignInGoogle}
        onSendRequest={handleSendFriendRequest}
        onAcceptRequest={handleAcceptFriendRequest}
        onDeclineRequest={handleDeclineFriendRequest}
        onRemoveFriendship={handleRemoveFriendship}
        onSelectPlayer={(entry) => setSelectedPlayerProfileId(entry.id)}
        onClose={() => setIsFriendsOpen(false)}
      />

      {/* Player Profile Modal (Self or Selected Friend) */}
      <PlayerProfileModal
        entry={selectedProfileEntry}
        playerStats={playerStats}
        activeTheme={displayTheme}
        currentPlayerId={currentPlayerId}
        friendships={friendships}
        isSignedIn={Boolean(authUser)}
        authEmail={authUser?.email}
        hasPendingSync={hasPendingSync}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        onEditName={() => setIsNameModalOpen(true)}
        onSendFriendRequest={handleSendFriendRequest}
        onAcceptFriendRequest={handleAcceptFriendRequest}
        onDeclineFriendRequest={handleDeclineFriendRequest}
        onRemoveFriendship={handleRemoveFriendship}
        onClose={() => {
          setIsMyProfileOpen(false);
          setSelectedPlayerProfileId(null);
        }}
      />

      {/* Floating Top Notifications (Renders above both screens AND open modals) */}
      {toastNotices.length > 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-24px)] max-w-[380px] pointer-events-none flex flex-col items-center gap-2.5">
          {toastNotices.map((toast) => (
            <div
              key={toast.id}
              style={{
                backgroundColor: displayTheme.cardBg,
                borderColor: toast.accent,
                boxShadow: `0 8px 28px rgba(0,0,0,0.72), 0 0 18px ${displayTheme.accentGlowRgba}`,
              }}
              className={`w-full rounded-2xl border px-3.5 py-3 flex items-center justify-between gap-2.5 animate-fadeIn ${
                dragging ? 'pointer-events-none' : 'pointer-events-auto'
              }`}
            >
              <div className="flex flex-col text-left min-w-0 flex-1 gap-1.5">
                {toast.badge && (
                  <span
                    style={{ color: toast.accent }}
                    className="text-[7.5px] font-black font-['Orbitron',sans-serif] tracking-widest uppercase leading-none"
                  >
                    {toast.badge}
                  </span>
                )}
                <span
                  style={{ color: toast.badge ? '#ffffff' : toast.accent }}
                  className="text-[10.5px] font-black font-['Orbitron',sans-serif] tracking-wide leading-tight truncate"
                >
                  {toast.title}
                </span>
                <span className="text-[9px] font-bold text-slate-300 font-['Orbitron',sans-serif] leading-snug">
                  {toast.subtitle}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {toast.actionLabel && toast.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.onAction?.();
                      dismissToast(toast.id);
                    }}
                    style={{
                      margin: 0,
                      backgroundColor: toast.accent,
                      color: '#070a11',
                    }}
                    className="px-2.5 py-1.5 rounded-xl text-[8.5px] font-black font-['Orbitron',sans-serif] tracking-wider hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                  >
                    {toast.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismissToast(toast.id)}
                  style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                  className="w-7 h-7 rounded-lg bg-[#141d2f] hover:bg-[#1a263d] border text-slate-400 hover:text-white text-[10px] font-bold flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Non-intrusive Offline Mode Indicator */}
      {!isNetworkOnline && (
        <div
          style={{
            backgroundColor: displayTheme.cardBg,
            borderColor: 'rgba(251, 191, 36, 0.5)',
          }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[65] pointer-events-none flex items-center gap-2 rounded-full border px-3 py-1.5 text-[9px] font-bold tracking-wider text-amber-300 font-['Orbitron',sans-serif] shadow-lg whitespace-nowrap"
        >
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          OFFLINE MODE • SAVING LOCALLY
        </div>
      )}

      {/* Main Container: Well inset from screen edges on all devices */}
      <main
        style={{
          backgroundColor: displayTheme.cardBg,
          borderColor: displayTheme.cardBorder,
        }}
        className="w-full max-w-[440px] h-full sm:h-[840px] sm:max-h-full rounded-2xl sm:rounded-3xl border shadow-2xl flex flex-col mx-auto relative overflow-hidden px-3.5 py-3.5 sm:px-6 sm:py-5 justify-between gap-2 transition-colors duration-300"
      >

        {/* VIEW 1: HOME SCREEN */}
        {activeScreen === 'home' && (
          <HomeScreen
            playerProfile={playerProfile}
            bestScore={bestScore}
            modeBestScore={modeBestScore}
            difficultyMode={difficultyMode}
            userRank={userRank}
            playerStats={playerStats}
            activeTheme={displayTheme}
            unclaimedDailyCount={unclaimedDailyCount}
            friendCount={acceptedFriendCount}
            incomingFriendRequests={incomingFriendRequestsCount}
            isSignedIn={Boolean(authUser)}
            isNetworkOnline={isNetworkOnline}
            hasPendingSync={hasPendingSync}
            isSyncingCloud={isSyncingCloud}
            onSignInGoogle={handleSignInGoogle}
            onOpenAudioSettings={() => setIsAudioSettingsOpen(true)}
            onSelectDifficulty={handleSelectDifficulty}
            onStartGame={handleStartGame}
            onOpenLeaderboard={() => openLeaderboard('home')}
            onOpenNameModal={() => setIsNameModalOpen(true)}
            onOpenMyProfile={() => setIsMyProfileOpen(true)}
            onOpenDaily={() => setProgressionModalTab('daily')}
            onOpenAchievements={() => setProgressionModalTab('achievements')}
            onOpenThemes={() => {
              setThemesModalTab('themes');
              setIsThemesOpen(true);
            }}
            onOpenFriends={() => setIsFriendsOpen(true)}
          />
        )}

        {/* VIEW 2: LEADERBOARD SCREEN */}
        {activeScreen === 'ranking' && (
          <LeaderboardScreen
            entries={rankingPlayers}
            userRank={rankingUserRank}
            userEntry={rankingUserEntry}
            selectedMode={leaderboardMode}
            onSelectMode={setLeaderboardMode}
            currentPlayerId={currentPlayerId}
            playerStats={playerStats}
            activeTheme={displayTheme}
            friendships={friendships}
            incomingFriendRequests={incomingFriendRequestsCount}
            isSignedIn={Boolean(authUser)}
            hasPendingSync={hasPendingSync}
            isSyncingCloud={isSyncingCloud}
            onSignInGoogle={handleSignInGoogle}
            onRefreshLeaderboard={refreshLeaderboardFromFirestore}
            onBack={() => setActiveScreen(previousScreen)}
            onPlayGame={() => setActiveScreen('game')}
            onOpenNameModal={() => setIsNameModalOpen(true)}
            onOpenFriends={() => setIsFriendsOpen(true)}
            onSendFriendRequest={handleSendFriendRequest}
            onAcceptFriendRequest={handleAcceptFriendRequest}
            onDeclineFriendRequest={handleDeclineFriendRequest}
            onRemoveFriendship={handleRemoveFriendship}
          />
        )}

        {/* VIEW 3: GAMEPLAY SCREEN */}
        {activeScreen === 'game' && (
          <>
            {/* Top Header Section: Balanced & compact above the board */}
            <header className="flex flex-col gap-2 w-full shrink-0 px-1 sm:px-1.5">
              {/* Top Bar: Home, Title, Settings */}
              <div className="flex items-center justify-between gap-2 w-full">
                {/* Home Return Button */}
                <button
                  type="button"
                  aria-label="Return to Home"
                  onClick={() => setActiveScreen('home')}
                  style={{
                    margin: 0,
                    backgroundColor: displayTheme.surfaceBg,
                    borderColor: displayTheme.surfaceBorder,
                  }}
                  className="btn-klick-icon rounded-xl border text-slate-300 hover:text-white active:scale-95 transition-all cursor-pointer shadow-sm shrink-0"
                  title="Main Menu"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                  </svg>
                </button>

                <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-[5px]">
                  <h1
                    style={{
                      color: displayTheme.titleTextColor,
                      filter: `drop-shadow(0 0 16px ${displayTheme.accentGlowRgba})`,
                    }}
                    className="text-lg sm:text-xl tracking-wider uppercase font-['Black_Ops_One',sans-serif] text-center px-1 select-none cursor-pointer flex items-center justify-center leading-none"
                    onClick={() => setActiveScreen('home')}
                    title="Main Menu"
                  >
                    KLICK
                  </h1>
                  <span className="text-[8px] font-bold tracking-[0.16em] text-slate-400 font-['Orbitron',sans-serif] leading-none truncate max-w-full">
                    {boardSize}×{boardSize} • {activeDifficulty.label} •{' '}
                    <span style={{ color: displayTheme.accentHex }}>
                      LV.{playerLevelInfo.level}
                    </span>
                  </span>
                </div>

                {/* Settings Button */}
                <button
                  type="button"
                  aria-label="Settings, Sound & Music"
                  onClick={() => setIsAudioSettingsOpen(true)}
                  style={{
                    margin: 0,
                    padding: 8,
                    backgroundColor: displayTheme.surfaceBg,
                    borderColor: displayTheme.surfaceBorder,
                  }}
                  className="btn-klick-icon rounded-xl border text-slate-400 hover:text-white cursor-pointer active:scale-95 transition-all shadow-sm shrink-0"
                  title="Settings (Music & Sound)"
                >
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                  </svg>
                </button>
              </div>

              {/* Score Cards Row */}
              <div className="grid grid-cols-2 gap-2.5 w-full">
                {/* Animated Score Card */}
                <ScoreCard
                  score={score}
                  combo={combo}
                  activeTheme={displayTheme}
                />

                {/* Best Score Card */}
                <div
                  style={{
                    backgroundColor: displayTheme.surfaceBg,
                    borderColor: displayTheme.surfaceBorder,
                  }}
                  className="border rounded-2xl px-3 py-2 flex flex-col justify-center gap-[5px] shadow-sm min-h-[46px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-bold text-slate-400 tracking-wider font-['Orbitron',sans-serif] leading-none">
                      BEST ({boardSize}×{boardSize})
                    </span>
                    <span className="text-[9px] text-slate-500 font-bold font-['Orbitron',sans-serif] leading-none">
                      #{userRank}
                    </span>
                  </div>
                  <div className="text-base sm:text-lg font-black text-[#f6c445] tracking-wide font-['Orbitron',sans-serif] leading-none tabular-nums">
                    {modeBestScore.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Live Combo Meter */}
              <div
                style={{
                  backgroundColor: displayTheme.surfaceBg,
                  borderColor:
                    combo >= 5
                      ? '#f43f5e'
                      : combo >= 2
                      ? comboTierInfo.color
                      : displayTheme.surfaceBorder,
                  boxShadow:
                    combo >= 5
                      ? `0 0 22px rgba(244, 63, 94, 0.55), 0 0 12px ${displayTheme.accentGlowRgba}`
                      : combo >= 2
                      ? `0 0 14px ${displayTheme.accentGlowRgba}`
                      : undefined,
                }}
                className="border rounded-xl px-3 py-1.5 flex flex-col gap-[5px] transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-2 text-[8px] font-black font-['Orbitron',sans-serif] tracking-wider leading-none">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-slate-400 shrink-0">COMBO METER</span>
                    <span
                      style={{ color: comboTierInfo.color }}
                      className={`truncate ${combo >= 3 ? 'animate-pulse' : ''}`}
                    >
                      • {combo >= 5 ? `${comboTierInfo.label} ⚡` : comboTierInfo.label}
                    </span>
                  </div>
                  <span
                    style={{ color: combo >= 2 ? comboTierInfo.color : displayTheme.accentHex }}
                    className="shrink-0"
                  >
                    {combo > 0 ? `${combo}×` : '0×'} ({comboMultiplierValue.toFixed(1)}× PTS)
                  </span>
                </div>

                <div className="w-full h-1.5 rounded-full bg-[#11192a] overflow-hidden grid grid-cols-5 gap-1.5 p-[1.5px]">
                  {[1, 2, 3, 4, 5].map((segment) => {
                    const isLit = combo >= segment;
                    return (
                      <div
                        key={segment}
                        style={{
                          backgroundColor: isLit
                            ? combo >= 5
                              ? segment === 5
                                ? '#fde047'
                                : '#f43f5e'
                              : segment >= 4
                              ? '#f43f5e'
                              : segment >= 2
                              ? '#fbbf24'
                              : displayTheme.accentHex
                            : '#1a253c',
                          boxShadow: isLit
                            ? `0 0 8px ${
                                combo >= 5
                                  ? '#f43f5e'
                                  : segment >= 4
                                  ? '#f43f5e'
                                  : displayTheme.accentHex
                              }`
                            : undefined,
                        }}
                        className="h-full rounded-full transition-all duration-200"
                      />
                    );
                  })}
                </div>
              </div>
            </header>

            {/* Center Playfield: Game Board + Block Spawning Tray */}
            <div className="w-full flex-1 flex flex-col items-center justify-center gap-3 sm:gap-4 my-auto min-h-0 px-1 py-1">
              {/* Game Board */}
              <section
                aria-label="Game Board"
                className="w-full flex items-center justify-center"
              >
                <div
                  ref={boardRef}
                  style={{
                    width: 'min(100%, 304px, 40dvh)',
                    aspectRatio: '1 / 1',
                    backgroundColor: displayTheme.boardBg,
                    padding: 10,
                    borderRadius: 18,
                    border: `1px solid ${combo >= 5 ? '#f43f5e' : displayTheme.boardBorder}`,
                    boxShadow:
                      combo >= 5
                        ? 'inset 0 2px 14px rgba(244, 63, 94, 0.25), 0 0 20px rgba(244, 63, 94, 0.35)'
                        : 'inset 0 2px 10px rgba(0, 0, 0, 0.7)',
                  }}
                  className={`relative select-none touch-none ${
                    isBoardShaking ? 'animate-board-shake' : ''
                  } ${comboFlareBurst ? 'animate-hypernova-board' : ''}`}
                >
                  <div
                    className={`grid ${boardSize >= 10 ? 'gap-[5px]' : 'gap-1.5'} w-full h-full relative`}
                    style={{
                      gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${boardSize}, minmax(0, 1fr))`,
                    }}
                  >
                    {grid.map((row, r) =>
                      row.map((cellColor, c) => {
                        const isPreview = isPreviewCell(r, c);
                        const isClearing = clearingCells.has(`${r},${c}`);
                        const activeColor: BlockColor | null = isPreview
                          ? dragging?.piece.color || null
                          : cellColor;

                        const theme = activeColor ? COLOR_THEMES[activeColor] : null;
                        const cellRadius =
                          boardSize <= 4
                            ? 'rounded-lg'
                            : boardSize >= 10
                            ? 'rounded-[4px]'
                            : 'rounded-[5px] sm:rounded-md';

                        return (
                          <div
                            key={`${r}-${c}`}
                            data-r={r}
                            data-c={c}
                            style={
                              !isClearing && !theme
                                ? {
                                    backgroundColor: displayTheme.emptyCellBg,
                                    borderColor: displayTheme.emptyCellBorder,
                                    borderWidth: 1,
                                    borderStyle: 'solid',
                                  }
                                : undefined
                            }
                            className={`relative overflow-hidden w-full h-full ${cellRadius} flex items-center justify-center transition-all duration-100 ${
                              isClearing
                                ? 'animate-cell-blast z-20'
                                : theme
                                ? isPreview
                                  ? `${theme.preview} scale-[0.98] border animate-pulse`
                                  : `${theme.solid} ${theme.shadow} border ${theme.border}`
                                : ''
                            }`}
                          >
                            {theme && !isClearing && (
                              <BlockSkinOverlay
                                skinId={displayBlockSkinId}
                                compact={boardSize >= 10}
                              />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Laser Beams sweeping across cleared Rows */}
                  {clearingRows.map((r) => (
                    <div
                      key={`laser-r-${r}`}
                      className="absolute left-2.5 right-2.5 pointer-events-none z-30 animate-laser-row rounded-sm bg-gradient-to-r from-transparent via-white to-transparent"
                      style={{
                        top: `calc(10px + ${r} * (100% - 20px) / ${boardSize})`,
                        height: `calc((100% - 20px) / ${boardSize})`,
                        transformOrigin: 'left center',
                        boxShadow: `0 0 28px ${displayTheme.laserGlowHex}`,
                      }}
                    />
                  ))}

                  {/* Laser Beams sweeping across cleared Columns */}
                  {clearingCols.map((c) => (
                    <div
                      key={`laser-c-${c}`}
                      className="absolute top-2.5 bottom-2.5 pointer-events-none z-30 animate-laser-col rounded-sm bg-gradient-to-b from-transparent via-white to-transparent"
                      style={{
                        left: `calc(10px + ${c} * (100% - 20px) / ${boardSize})`,
                        width: `calc((100% - 20px) / ${boardSize})`,
                        transformOrigin: 'center top',
                        boxShadow: `0 0 28px ${displayTheme.laserGlowHex}`,
                      }}
                    />
                  ))}

                  {/* Flying Floating Score & Multiplier Popups - Pure sharp typography, zero box or border */}
                  {flyingMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className="absolute left-1/2 top-1/2 pointer-events-none z-40 animate-flying-score flex flex-col items-center justify-center text-center select-none gap-1.5"
                    >
                      <span
                        className="text-2xl sm:text-3xl font-black font-['Orbitron',sans-serif] tracking-wider leading-none"
                        style={{
                          color: msg.accentColor,
                          textShadow: `0 2px 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.85), 0 0 16px ${msg.accentColor}`,
                        }}
                      >
                        {msg.multiplier}x
                      </span>
                      <span
                        className="text-xl sm:text-2xl font-black text-white font-['Orbitron',sans-serif] tracking-wide leading-tight tabular-nums"
                        style={{
                          textShadow: '0 2px 5px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.85), 0 0 14px rgba(255,255,255,0.7)',
                        }}
                      >
                        +{msg.points}
                      </span>
                    </div>
                  ))}

                  {/* Combo 5+ Level-Up Particle Flare & Shockwave */}
                  <ComboFlareOverlay burst={comboFlareBurst} />
                </div>
              </section>

              {/* Block Spawn Area (Piece Tray) */}
              <section aria-label="Piece Tray" className="w-full flex items-center justify-center">
                <div
                  style={{ width: 'min(100%, 304px, 40dvh)' }}
                  className="relative grid grid-cols-3 gap-2.5 sm:gap-3"
                >
                  {tray.map((piece, slotIdx) => {
                    const isCurrentlyDragging = dragging?.trayIndex === slotIdx;

                    return (
                      <div
                        key={slotIdx}
                        data-tray-slot={slotIdx}
                        style={{
                          height: 76,
                          borderRadius: 16,
                          backgroundColor: displayTheme.surfaceBg,
                          border: `1px solid ${displayTheme.surfaceBorder}`,
                        }}
                        className="flex items-center justify-center relative touch-none select-none transition-transform active:scale-95 cursor-grab hover:brightness-110"
                        onPointerDown={(e) => {
                          if (piece) handlePointerDownPiece(e, piece, slotIdx);
                        }}
                      >
                        {piece && !isCurrentlyDragging && renderMiniPiece(piece)}
                        {!piece && (
                          <span
                            style={{ backgroundColor: displayTheme.surfaceBorder }}
                            className="w-2 h-2 rounded-full"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Bottom Navigation: Clean separation & zero bottom overflow */}
            <nav
              style={{ borderColor: displayTheme.surfaceBorder }}
              className="w-full flex items-center justify-around border-t pt-2.5 pb-1 px-2 sm:px-4 shrink-0 gap-3"
              aria-label="Navigation"
            >
              {/* Play Tab */}
              <button
                type="button"
                onClick={() => setActiveScreen('game')}
                style={{
                  margin: 0,
                  color: displayTheme.accentHex,
                }}
                className="flex-1 max-w-[88px] min-h-[44px] py-1.5 px-2 rounded-xl flex flex-col items-center justify-center text-center gap-1.5 cursor-pointer hover:bg-white/5 transition-colors box-border"
              >
                <div
                  style={{ backgroundColor: displayTheme.surfaceBg }}
                  className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0"
                >
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                </div>
                <span className="text-[9px] font-bold tracking-wider font-['Orbitron',sans-serif] leading-none text-center">
                  PLAY
                </span>
              </button>

              {/* Rank Tab */}
              <button
                type="button"
                onClick={() => openLeaderboard('game')}
                style={{ margin: 0 }}
                className="flex-1 max-w-[88px] min-h-[44px] py-1.5 px-2 rounded-xl flex flex-col items-center justify-center text-center gap-1.5 text-slate-400 hover:text-white cursor-pointer hover:bg-white/5 active:scale-95 transition-all box-border"
                title="View Leaderboard"
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M5 19h3v-6H5v6zm6 0h3V5h-3v14zm6 0h3v-9h-3v9z" />
                  </svg>
                </div>
                <span className="text-[9px] font-bold tracking-wider font-['Orbitron',sans-serif] leading-none text-center">
                  RANK
                </span>
              </button>

              {/* Settings / Pause Tab */}
              <button
                type="button"
                onClick={() => setIsPaused(true)}
                style={{ margin: 0 }}
                className="flex-1 max-w-[88px] min-h-[44px] py-1.5 px-2 rounded-xl flex flex-col items-center justify-center text-center gap-1.5 text-slate-400 hover:text-slate-200 cursor-pointer hover:bg-white/5 transition-colors box-border"
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                  </svg>
                </div>
                <span className="text-[9px] font-bold tracking-wider font-['Orbitron',sans-serif] leading-none text-center">
                  SETTINGS
                </span>
              </button>
            </nav>

            {/* Pause / Settings Modal Overlay */}
            {isPaused && (
              <div className="absolute inset-0 bg-[#070a11]/90 backdrop-blur-sm z-40 flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-fadeIn select-none">
                <div
                  style={{
                    backgroundColor: displayTheme.cardBg,
                    borderColor: displayTheme.cardBorder,
                  }}
                  className="w-full max-w-[340px] max-h-full overflow-y-auto border rounded-2xl p-4 sm:p-6 shadow-2xl flex flex-col gap-4 custom-scrollbar"
                >
                  <div
                    style={{ borderColor: displayTheme.surfaceBorder }}
                    className="flex items-center justify-between gap-2 border-b pb-3 px-1"
                  >
                    <h2 className="text-sm font-black text-white font-['Orbitron',sans-serif] tracking-wider leading-normal">
                      GAME PAUSED
                    </h2>
                    <span
                      style={{ color: displayTheme.accentHex }}
                      className="text-[10px] font-['Orbitron',sans-serif] font-bold leading-normal"
                    >
                      SETTINGS
                    </span>
                  </div>

                  {/* Audio Volume Controls (Directly accessible in Pause) */}
                  <div
                    style={{
                      backgroundColor: displayTheme.surfaceBg,
                      borderColor: displayTheme.surfaceBorder,
                    }}
                    className="border rounded-xl p-3.5 flex flex-col gap-3.5 text-left"
                  >
                    {/* Music Loudness */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-slate-300 font-['Orbitron',sans-serif] flex items-center gap-1.5">
                          <span style={{ color: displayTheme.accentHex }}>
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                          </span>
                          MUSIC
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            style={{ color: displayTheme.accentHex }}
                            className="text-[10px] font-black font-['Orbitron',sans-serif] tabular-nums"
                          >
                            {Math.round(musicVolume * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={toggleMusic}
                            style={{
                              margin: 0,
                              backgroundColor: musicEnabled ? displayTheme.boardBg : '#181f2f',
                              borderColor: musicEnabled ? displayTheme.accentHex : '#25324b',
                              color: musicEnabled ? displayTheme.accentHex : '#64748b',
                            }}
                            className="min-h-[44px] px-5 py-2 rounded-xl border font-['Orbitron',sans-serif] cursor-pointer transition-colors text-xs font-bold flex items-center justify-center leading-normal box-border"
                          >
                            {musicEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(musicVolume * 100)}
                        onChange={(e) => handleMusicVolumeChange(parseFloat(e.target.value) / 100)}
                        style={{ accentColor: displayTheme.accentHex }}
                        className="cyber-slider w-full"
                        aria-label="Adjust background music loudness"
                      />
                    </div>

                    {/* Sound FX Loudness */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-slate-300 font-['Orbitron',sans-serif] flex items-center gap-1.5">
                          <span style={{ color: displayTheme.accentHex }}>
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                            </svg>
                          </span>
                          SOUND FX
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            style={{ color: displayTheme.accentHex }}
                            className="text-[10px] font-black font-['Orbitron',sans-serif] tabular-nums"
                          >
                            {Math.round(soundVolume * 100)}%
                          </span>
                          <button
                            type="button"
                            onClick={toggleSound}
                            style={{
                              margin: 0,
                              backgroundColor: soundEnabled ? displayTheme.boardBg : '#181f2f',
                              borderColor: soundEnabled ? displayTheme.accentHex : '#25324b',
                              color: soundEnabled ? displayTheme.accentHex : '#64748b',
                            }}
                            className="min-h-[44px] px-5 py-2 rounded-xl border font-['Orbitron',sans-serif] cursor-pointer transition-colors text-xs font-bold flex items-center justify-center leading-normal box-border"
                          >
                            {soundEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(soundVolume * 100)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) / 100;
                          handleSoundVolumeChange(val);
                          playSoundVolumePreview(val);
                        }}
                        style={{ accentColor: displayTheme.accentHex }}
                        className="cyber-slider w-full"
                        aria-label="Adjust sound effects loudness"
                      />
                    </div>

                    {/* Haptic Feedback Toggle */}
                    <div
                      style={{ borderColor: displayTheme.surfaceBorder }}
                      className="flex items-center justify-between gap-2 pt-2.5 border-t"
                    >
                      <span className="text-[10px] font-bold text-slate-300 font-['Orbitron',sans-serif] flex items-center gap-1.5">
                        <span style={{ color: displayTheme.accentHex }}>
                          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M0 15h2V9H0v6zm3 2h2V7H3v10zm19-8v6h2V9h-2zm-3 8h2V7h-2v10zM16.5 3h-9C6.67 3 6 3.67 6 4.5v15c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5v-15c0-.83-.67-1.5-1.5-1.5zM16 19H8V5h8v14z" />
                          </svg>
                        </span>
                        HAPTICS
                      </span>
                      <button
                        type="button"
                        onClick={toggleHaptics}
                        style={{
                          margin: 0,
                          backgroundColor: hapticsEnabled ? displayTheme.boardBg : '#181f2f',
                          borderColor: hapticsEnabled ? displayTheme.accentHex : '#25324b',
                          color: hapticsEnabled ? displayTheme.accentHex : '#64748b',
                        }}
                        className="min-h-[42px] px-5 py-2 rounded-xl border font-['Orbitron',sans-serif] cursor-pointer transition-colors text-xs font-bold flex items-center justify-center leading-normal box-border"
                      >
                        {hapticsEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {/* Switch Difficulty / Board Size */}
                    <div
                      style={{ borderColor: displayTheme.surfaceBorder }}
                      className="pt-2.5 border-t flex flex-col gap-2"
                    >
                      <span className="text-[9px] font-bold text-slate-400 font-['Orbitron',sans-serif] tracking-wider block">
                        BOARD SIZE & DIFFICULTY
                      </span>
                      <div className="grid grid-cols-4 gap-2 w-full">
                        {DIFFICULTY_ORDER.map((modeId) => {
                          const cfg = DIFFICULTY_MODES[modeId];
                          const isSelected = difficultyMode === modeId;
                          return (
                            <button
                              key={modeId}
                              type="button"
                              onClick={() => handleSelectDifficulty(modeId)}
                              style={{
                                margin: 0,
                                backgroundColor: isSelected ? displayTheme.boardBg : '#141b2e',
                                borderColor: isSelected ? displayTheme.accentHex : '#222f4b',
                                color: isSelected ? displayTheme.accentHex : '#94a3b8',
                              }}
                              className="flex flex-col items-center justify-center gap-1.5 py-2 px-1.5 rounded-lg border transition-all cursor-pointer"
                            >
                              <span className="text-[10px] font-black font-['Orbitron',sans-serif] leading-none">
                                {cfg.boardSize}×{cfg.boardSize}
                              </span>
                              <span className="text-[7px] font-bold tracking-wider font-['Orbitron',sans-serif] leading-none">
                                {cfg.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Navigation Actions: >= 8px gaps */}
                  <div className="flex flex-col gap-2.5 pt-1">
                    <div className="grid grid-cols-2 gap-2.5 w-full">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPaused(false);
                          setIsThemesOpen(true);
                        }}
                        style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                        className="btn-klick rounded-xl bg-[#141b2e] border text-slate-200 hover:text-white font-bold tracking-wider text-[10.5px] font-['Orbitron',sans-serif] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                      >
                        THEMES
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPaused(false);
                          setProgressionModalTab('daily');
                        }}
                        style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                        className="btn-klick rounded-xl bg-[#141b2e] border text-slate-200 hover:text-white font-bold tracking-wider text-[10.5px] font-['Orbitron',sans-serif] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                      >
                        DAILY & AWARDS
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsPaused(false)}
                      style={{
                        margin: 0,
                        backgroundColor: displayTheme.primaryBtnBg,
                        color: displayTheme.primaryBtnText,
                        boxShadow: `0 0 16px ${displayTheme.accentGlowRgba}`,
                      }}
                      className="btn-klick w-full rounded-2xl font-black tracking-wider text-xs sm:text-sm font-['Orbitron',sans-serif] active:scale-95 transition-all cursor-pointer"
                    >
                      RESUME
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsPaused(false);
                        openLeaderboard('game');
                      }}
                      style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                      className="btn-klick w-full rounded-xl bg-[#141b2e] border text-slate-200 hover:text-white font-bold tracking-wider text-xs font-['Orbitron',sans-serif] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                    >
                      LEADERBOARD
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPreviewThemeId(null);
                        setPreviewBlockSkinId(null);
                        setIsPaused(false);
                        setActiveScreen('home');
                      }}
                      style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                      className="btn-klick w-full rounded-xl bg-[#141b2e] border text-slate-200 hover:text-white font-bold tracking-wider text-xs font-['Orbitron',sans-serif] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                    >
                      HOME SCREEN
                    </button>

                    <button
                      type="button"
                      onClick={() => resetGame()}
                      style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                      className="btn-klick w-full rounded-xl bg-[#141b2e] border hover:border-rose-500/40 text-slate-400 hover:text-rose-300 font-bold tracking-wider text-xs font-['Orbitron',sans-serif] hover:bg-[#1a253f] active:scale-95 transition-all cursor-pointer"
                    >
                      RESTART
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Ending Screen (Clean, Scroll-safe & Calm) */}
            {isGameOver && (
              <div className="absolute inset-0 bg-[#070a11]/95 backdrop-blur-md z-40 overflow-y-auto p-4 sm:p-6 flex flex-col items-center text-center animate-fadeIn select-none custom-scrollbar">
                <div className="my-auto w-full max-w-[320px] flex flex-col items-center gap-3.5">
                  {isNewRecord && score > 0 ? (
                    <span className="px-4 py-1.5 rounded-full bg-[#f6c445]/20 text-[#f6c445] border border-[#f6c445]/40 text-[10px] font-bold tracking-widest uppercase leading-normal flex items-center justify-center">
                      NEW ALL-TIME RECORD
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase leading-normal flex items-center justify-center">
                      SESSION COMPLETED • {formatDuration(sessionElapsedSec)}
                    </span>
                  )}

                  <h2 className="text-3xl font-black text-white font-['Orbitron',sans-serif] tracking-wider leading-tight flex items-center justify-center text-center">
                    GAME OVER
                  </h2>

                  {/* Score Summary Box */}
                  <div
                    style={{
                      backgroundColor: displayTheme.surfaceBg,
                      borderColor: displayTheme.surfaceBorder,
                    }}
                    className="w-full border rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col gap-3.5"
                  >
                    <div className="flex flex-col items-center justify-center text-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 tracking-wider leading-normal">
                        FINAL SCORE
                      </span>
                      <span
                        style={{ color: displayTheme.accentHex }}
                        className="text-3xl font-black tracking-wide font-['Orbitron',sans-serif] leading-tight tabular-nums"
                      >
                        {score.toLocaleString()}
                      </span>
                    </div>

                    <div className="h-px bg-[#192338]" />

                    {/* Stats Grid: Best, Lines Cleared, Max Combo */}
                    <div className="grid grid-cols-3 gap-2 text-center font-['Orbitron',sans-serif]">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <span className="text-[9px] font-bold text-slate-400 leading-normal">BEST</span>
                        <span className="text-sm font-black text-[#f6c445] leading-normal tabular-nums">
                          {modeBestScore.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center gap-1.5 border-x border-[#192338] px-1">
                        <span className="text-[9px] font-bold text-slate-400 leading-normal">LINES</span>
                        <span className="text-sm font-black text-white leading-normal tabular-nums">
                          {totalLinesCleared}
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <span className="text-[9px] font-bold text-slate-400 leading-normal">COMBO</span>
                        <span className="text-sm font-black text-[#f43f5e] leading-normal tabular-nums">
                          {maxCombo > 0 ? `${maxCombo}x` : '1x'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-3 w-full">
                    <button
                      type="button"
                      onClick={() => resetGame()}
                      style={{
                        margin: 0,
                        backgroundColor: displayTheme.primaryBtnBg,
                        color: displayTheme.primaryBtnText,
                        boxShadow: `0 0 20px ${displayTheme.accentGlowRgba}`,
                      }}
                      className="btn-klick w-full rounded-2xl font-black tracking-widest text-xs sm:text-sm font-['Orbitron',sans-serif] active:scale-95 transition-all cursor-pointer"
                    >
                      PLAY AGAIN
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsGameOver(false);
                        openLeaderboard('game');
                      }}
                      style={{ margin: 0, borderColor: displayTheme.surfaceBorder }}
                      className="btn-klick w-full rounded-xl bg-[#121828] border text-slate-200 hover:text-white font-bold tracking-wider text-xs font-['Orbitron',sans-serif] active:scale-95 transition-all cursor-pointer"
                    >
                      LEADERBOARD
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsGameOver(false);
                        setActiveScreen('home');
                      }}
                      style={{ margin: 0 }}
                      className="btn-klick w-full rounded-xl bg-transparent hover:bg-[#121828] border border-[#1d273f]/60 hover:border-[#1d273f] text-slate-400 hover:text-slate-200 font-bold tracking-wider text-xs font-['Orbitron',sans-serif] active:scale-95 transition-all cursor-pointer"
                    >
                      MAIN MENU
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating Dragging Overlay with 1:1 board cell dimension match */}
      {renderFloatingDraggingPiece()}
    </div>
  );
}
