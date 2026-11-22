/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PlayerProfile, getTierFromScore, getTierBadgeStyle } from '../game/leaderboard';
import { DifficultyModeId } from '../game/types';
import { DIFFICULTY_MODES, DIFFICULTY_ORDER, getDifficultyConfig } from '../game/shapes';
import { ACHIEVEMENTS, PlayerStats, getLevelInfo } from '../game/progression';
import { GameTheme } from '../game/themes';
import { PlayerAvatar } from './PlayerAvatar';
import { PWAInstallButton } from './PWAInstallButton';

interface HomeScreenProps {
  playerProfile: PlayerProfile;
  bestScore: number;
  modeBestScore: number;
  difficultyMode: DifficultyModeId;
  userRank: number;
  playerStats: PlayerStats;
  activeTheme: GameTheme;
  unclaimedDailyCount: number;
  friendCount: number;
  incomingFriendRequests: number;
  isSignedIn: boolean;
  isNetworkOnline?: boolean;
  hasPendingSync: boolean;
  isSyncingCloud: boolean;
  onSignInGoogle: () => void;
  onOpenAudioSettings: () => void;
  onSelectDifficulty: (mode: DifficultyModeId) => void;
  onStartGame: () => void;
  onOpenLeaderboard: () => void;
  onOpenNameModal: () => void;
  onOpenMyProfile: () => void;
  onOpenDaily: () => void;
  onOpenAchievements: () => void;
  onOpenThemes: () => void;
  onOpenFriends: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  playerProfile,
  bestScore,
  modeBestScore,
  difficultyMode,
  userRank,
  playerStats,
  activeTheme,
  unclaimedDailyCount,
  friendCount,
  incomingFriendRequests,
  isSignedIn,
  isNetworkOnline = true,
  hasPendingSync,
  isSyncingCloud,
  onSignInGoogle,
  onOpenAudioSettings,
  onSelectDifficulty,
  onStartGame,
  onOpenLeaderboard,
  onOpenNameModal,
  onOpenMyProfile,
  onOpenDaily,
  onOpenAchievements,
  onOpenThemes,
  onOpenFriends,
}) => {
  const tier = getTierFromScore(bestScore);
  const tierStyle = getTierBadgeStyle(tier);
  const initial = (playerProfile.avatarLetter || playerProfile.username.charAt(0) || 'P').toUpperCase();
  const activeModeConfig = getDifficultyConfig(difficultyMode);
  const levelInfo = getLevelInfo(playerStats.xp);

  return (
    <div className="w-full h-full flex flex-col justify-between items-center text-center select-none animate-fadeIn gap-2.5 overflow-hidden">
      {/* Top Header Bar: Balanced inset & guaranteed >= 8px separation */}
      <header className="w-full flex items-center justify-between gap-2.5 px-1 pt-0.5 shrink-0">
        {/* Player Profile Chip -> Opens full player profile & stats */}
        <button
          type="button"
          onClick={onOpenMyProfile}
          style={{
            backgroundColor: activeTheme.surfaceBg,
            borderColor: activeTheme.surfaceBorder,
          }}
          className="btn-klick rounded-xl border transition-all cursor-pointer group active:scale-95 shadow-sm gap-2.5 flex-1 min-w-0 justify-start px-2.5 py-2"
          title="View Player Profile & Stats"
        >
          <PlayerAvatar
            letter={initial}
            avatarUrl={playerProfile.avatarUrl}
            sizeClass="w-8 h-8"
            textClass="text-xs"
            accentColor={activeTheme.accentHex}
            bgColor={activeTheme.boardBg}
            borderColor={activeTheme.surfaceBorder}
          />

          <div className="flex flex-col text-left justify-center min-w-0 flex-1 gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-white font-['Orbitron',sans-serif] transition-colors truncate leading-none">
                {playerProfile.username}
              </span>
              {playerProfile.tag && (
                <span className="text-[9.5px] text-slate-400 font-mono shrink-0 leading-none">
                  #{playerProfile.tag}
                </span>
              )}
              <span
                style={{ color: activeTheme.accentHex }}
                className="text-[8px] font-black px-1.5 py-0.5 rounded bg-[#121d33] border border-[#233554] font-['Orbitron',sans-serif] shrink-0 leading-none"
              >
                LV.{levelInfo.level}
              </span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  !isNetworkOnline
                    ? 'bg-amber-400 animate-pulse'
                    : isSignedIn
                    ? isSyncingCloud || hasPendingSync
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                    : 'bg-slate-500'
                }`}
              />
              <span className="text-[8px] text-slate-400 font-['Orbitron',sans-serif] tracking-wider leading-none truncate">
                {!isNetworkOnline
                  ? 'OFFLINE MODE'
                  : isSignedIn
                  ? hasPendingSync
                    ? 'OFFLINE QUEUED'
                    : 'CLOUD SAVED'
                  : 'LOCAL GUEST'}
              </span>
            </div>
          </div>
        </button>

        {/* Settings & Name Edit Buttons (Top Right Corner) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenNameModal}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: activeTheme.surfaceBorder,
            }}
            className="btn-klick-icon rounded-xl border text-slate-400 hover:text-white cursor-pointer active:scale-95 transition-all shadow-sm shrink-0 p-2"
            aria-label="Edit player name and profile picture"
            title="Edit Name & PFP"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onOpenAudioSettings}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: activeTheme.surfaceBorder,
            }}
            className="btn-klick-icon rounded-xl border text-slate-400 hover:text-white cursor-pointer active:scale-95 transition-all shadow-sm shrink-0 p-2"
            aria-label="Settings, Sound & Music"
            title="Settings (Music & Sound)"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Central Branding & Hub (scroll-safe on compact viewports so nothing collides) */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col items-center justify-evenly gap-3 py-1 px-1">
        {/* Title */}
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <h1
            style={{
              color: activeTheme.titleTextColor,
              filter: `drop-shadow(0 0 18px ${activeTheme.accentGlowRgba})`,
            }}
            className="text-3xl sm:text-4xl font-black font-['Black_Ops_One',sans-serif] tracking-wider leading-none text-center"
          >
            KLICK
          </h1>
          <p className="text-[9.5px] font-bold tracking-[0.26em] text-slate-400 font-['Orbitron',sans-serif] uppercase leading-normal text-center">
            BLOCK PUZZLE
          </p>
        </div>

        {/* Clean Score & Level Card */}
        <div
          style={{
            backgroundColor: activeTheme.surfaceBg,
            borderColor: activeTheme.surfaceBorder,
          }}
          className="w-full max-w-[350px] border rounded-2xl px-3.5 py-2.5 flex flex-col gap-2 shadow-sm shrink-0"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col text-left justify-center gap-[5px] min-w-0">
              <span className="text-[8.5px] font-bold text-slate-400 font-['Orbitron',sans-serif] tracking-wider leading-none">
                {activeModeConfig.boardSize}×{activeModeConfig.boardSize} BEST
              </span>
              <span className="text-lg font-black text-[#f6c445] font-['Orbitron',sans-serif] leading-none tabular-nums">
                {modeBestScore.toLocaleString()}
              </span>
            </div>

            <div className="flex flex-col items-end justify-center gap-[5px] shrink-0">
              <span className="text-[8.5px] font-bold text-slate-400 font-['Orbitron',sans-serif] tracking-wider leading-none">
                GLOBAL RANK
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-white font-['Orbitron',sans-serif] leading-none tabular-nums">
                  #{userRank}
                </span>
                <span
                  className={`text-[8.5px] font-bold px-2 py-0.5 rounded-full border ${tierStyle.bg} ${tierStyle.text} ${tierStyle.border} font-['Orbitron',sans-serif] leading-none`}
                >
                  {tier}
                </span>
              </div>
            </div>
          </div>

          {/* Mini XP Progress Bar */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between gap-2 text-[8.5px] font-bold font-['Orbitron',sans-serif]">
              <span style={{ color: activeTheme.accentHex }} className="truncate">
                LV.{levelInfo.level} {levelInfo.rankTitle.toUpperCase()}
              </span>
              <span className="text-slate-400 tabular-nums shrink-0">
                {levelInfo.xpIntoLevel}/{levelInfo.xpNeededForNext} XP
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#131c2e] overflow-hidden">
              <div
                style={{
                  width: `${levelInfo.progressPercent}%`,
                  backgroundColor: activeTheme.accentHex,
                }}
                className="h-full rounded-full transition-all duration-300"
              />
            </div>
            {!isSignedIn && (
              <div className="flex items-center justify-between pt-2 mt-0.5 border-t border-white/10 gap-2.5">
                <span className="text-[8px] text-slate-400 font-['Orbitron',sans-serif] truncate text-left">
                  SYNC PROFILE & FRIENDS ACROSS DEVICES
                </span>
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  style={{
                    color: activeTheme.accentHex,
                    borderColor: activeTheme.surfaceBorder,
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#121c30] border text-[8px] font-black font-['Orbitron',sans-serif] tracking-wider hover:brightness-125 cursor-pointer shrink-0"
                >
                  SIGN IN
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Difficulty & Board Size Selector */}
        <div className="w-full max-w-[350px] flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[9px] font-bold tracking-widest text-slate-400 font-['Orbitron',sans-serif] uppercase truncate">
              MODE & BOARD SIZE
            </span>
            <span
              style={{ color: activeTheme.accentHex }}
              className="text-[9px] font-bold tracking-wider font-['Orbitron',sans-serif] shrink-0"
            >
              {activeModeConfig.subtitle}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 w-full">
            {DIFFICULTY_ORDER.map((modeId) => {
              const cfg = DIFFICULTY_MODES[modeId];
              const isSelected = difficultyMode === modeId;

              return (
                <button
                  key={modeId}
                  type="button"
                  onClick={() => onSelectDifficulty(modeId)}
                  style={{
                    backgroundColor: isSelected ? activeTheme.surfaceBg : '#0c1220',
                    borderColor: isSelected ? activeTheme.accentHex : activeTheme.surfaceBorder,
                    boxShadow: isSelected ? `0 0 14px ${activeTheme.accentGlowRgba}` : undefined,
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-xl border transition-all cursor-pointer active:scale-95 text-slate-300 hover:text-white"
                >
                  <span
                    style={{ color: isSelected ? activeTheme.accentHex : '#e2e8f0' }}
                    className="text-xs font-black font-['Orbitron',sans-serif] leading-none"
                  >
                    {cfg.boardSize}×{cfg.boardSize}
                  </span>
                  <span className="text-[8px] font-bold tracking-wider font-['Orbitron',sans-serif] leading-none">
                    {cfg.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Progression, Themes & Friends Quick Hub */}
        <div className="grid grid-cols-4 gap-2 w-full max-w-[350px] shrink-0">
          <button
            type="button"
            onClick={onOpenDaily}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: unclaimedDailyCount > 0 ? activeTheme.accentHex : activeTheme.surfaceBorder,
            }}
            className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-xl border text-slate-200 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            <span className="flex items-center justify-center gap-1.5 text-[10px] font-black text-amber-300 font-['Orbitron',sans-serif] leading-none">
              <span>🔥 {playerStats.dailyStreak}d</span>
              {unclaimedDailyCount > 0 && (
                <span
                  style={{ backgroundColor: activeTheme.accentHex }}
                  className="w-2 h-2 rounded-full animate-pulse shrink-0"
                  aria-label="Unclaimed quest available"
                />
              )}
            </span>
            <span className="text-[7.5px] font-bold tracking-wider text-slate-300 font-['Orbitron',sans-serif] leading-none">
              DAILY
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenAchievements}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: activeTheme.surfaceBorder,
            }}
            className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-xl border text-slate-200 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            <span
              style={{ color: activeTheme.accentHex }}
              className="text-[10px] font-black font-['Orbitron',sans-serif] leading-none tabular-nums"
            >
              {playerStats.unlockedAchievements.length}/{ACHIEVEMENTS.length}
            </span>
            <span className="text-[7.5px] font-bold tracking-wider text-slate-300 font-['Orbitron',sans-serif] leading-none">
              AWARDS
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenThemes}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: activeTheme.surfaceBorder,
            }}
            className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-xl border text-slate-200 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            <span className="flex items-center gap-1.5 leading-none">
              <span
                style={{ backgroundColor: activeTheme.swatchPrimary }}
                className="w-2.5 h-2.5 rounded-full inline-block"
              />
              <span
                style={{ backgroundColor: activeTheme.swatchSecondary }}
                className="w-2.5 h-2.5 rounded-full inline-block"
              />
            </span>
            <span className="text-[7.5px] font-bold tracking-wider text-slate-300 font-['Orbitron',sans-serif] leading-none">
              THEMES
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenFriends}
            style={{
              backgroundColor: activeTheme.surfaceBg,
              borderColor: incomingFriendRequests > 0 ? '#fb7185' : activeTheme.surfaceBorder,
            }}
            className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-xl border text-slate-200 hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          >
            <span className="flex items-center justify-center gap-1.5 leading-none">
              <span
                style={{ color: activeTheme.accentHex }}
                className="text-[10px] font-black font-['Orbitron',sans-serif] tabular-nums"
              >
                {friendCount}
              </span>
              {incomingFriendRequests > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[7px] font-black leading-none shrink-0">
                  +{incomingFriendRequests}
                </span>
              )}
            </span>
            <span className="text-[7.5px] font-bold tracking-wider text-slate-300 font-['Orbitron',sans-serif] leading-none">
              FRIENDS
            </span>
          </button>
        </div>
      </div>

      {/* Spacious Main Action Buttons + Quiet Footer */}
      <div className="w-full max-w-[350px] px-1 flex flex-col gap-2.5 shrink-0">
        {/* PRIMARY: JUMP INTO THE GAME */}
        <button
          type="button"
          onClick={onStartGame}
          style={{
            backgroundColor: activeTheme.primaryBtnBg,
            color: activeTheme.primaryBtnText,
            boxShadow: `0 0 24px ${activeTheme.accentGlowRgba}`,
          }}
          className="btn-klick w-full rounded-2xl font-black tracking-widest text-xs sm:text-sm font-['Orbitron',sans-serif] active:scale-95 transition-all cursor-pointer"
        >
          JUMP INTO THE GAME
        </button>

        {/* SECONDARY: LEADERBOARD */}
        <button
          type="button"
          onClick={onOpenLeaderboard}
          style={{
            backgroundColor: activeTheme.surfaceBg,
            borderColor: activeTheme.surfaceBorder,
          }}
          className="btn-klick w-full rounded-xl border text-slate-200 hover:text-white font-bold tracking-wider text-xs font-['Orbitron',sans-serif] hover:brightness-110 active:scale-95 transition-all cursor-pointer"
        >
          LEADERBOARD
        </button>

        {/* PWA Install / Add to Home Screen Button (auto-hides when installed) */}
        <PWAInstallButton activeTheme={activeTheme} />

        <footer className="text-[9px] text-slate-500 font-['Orbitron',sans-serif] tracking-widest uppercase pt-1 leading-none">
          Match Rows & Columns
        </footer>
      </div>
    </div>
  );
};

