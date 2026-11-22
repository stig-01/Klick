/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GameTheme } from '../game/themes';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  activeTheme: GameTheme;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ activeTheme }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handlePress = async () => {
    if (isInstallable) {
      const accepted = await install().catch(() => false);
      if (accepted) return;
    }
    setCopiedUrl(false);
    setShowGuideModal(true);
  };

  const handleCopyUrl = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined') {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedUrl(true);
        window.setTimeout(() => setCopiedUrl(false), 2000);
      }
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handlePress}
        style={{
          backgroundColor: activeTheme.surfaceBg,
          borderColor: activeTheme.accentHex,
          color: activeTheme.accentHex,
        }}
        className="btn-klick w-full rounded-xl border font-bold tracking-wider text-[10.5px] font-['Orbitron',sans-serif] hover:brightness-125 active:scale-95 transition-all cursor-pointer gap-2"
        title="Add Klick to your home screen to play offline"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span>
          {isInstallable
            ? 'INSTALL FOR OFFLINE PLAY'
            : 'ADD TO HOME SCREEN (OFFLINE)'}
        </span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div
            style={{
              backgroundColor: activeTheme.cardBg,
              borderColor: activeTheme.cardBorder,
            }}
            className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl flex flex-col gap-3.5 text-left"
          >
            <h3 className="text-sm font-black text-white font-['Orbitron',sans-serif] tracking-wider">
              INSTALL KLICK FOR OFFLINE PLAY
            </h3>

            {isInIframe && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 text-[11px] text-amber-200 leading-relaxed font-['Orbitron',sans-serif]">
                You are currently inside a preview frame. Browsers only allow app installation when opened directly in a normal browser tab.
              </div>
            )}

            {isIOS ? (
              <p className="text-[11px] text-slate-300 leading-relaxed font-['Orbitron',sans-serif]">
                <strong className="text-white">iPhone / iPad (Safari):</strong>
                <br />
                1. Open this link in <strong className="text-white">Safari</strong>.
                <br />
                2. Tap the <strong className="text-white">Share</strong> button in the toolbar.
                <br />
                3. Tap <strong className="text-white">Add to Home Screen</strong>.
              </p>
            ) : (
              <p className="text-[11px] text-slate-300 leading-relaxed font-['Orbitron',sans-serif]">
                <strong className="text-white">Android (Chrome):</strong> Tap <strong className="text-white">⋮ Menu</strong> → <strong className="text-white">Install app</strong> or <strong className="text-white">Add to Home screen</strong>.
                <br />
                <br />
                <strong className="text-white">Desktop (Chrome / Edge):</strong> Open in its own tab, then click the <strong className="text-white">Install</strong> icon on the right side of the address bar (or <strong className="text-white">⋮ → Cast, save, and share → Install Klick</strong>).
              </p>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={handleCopyUrl}
                style={{
                  backgroundColor: activeTheme.surfaceBg,
                  borderColor: activeTheme.surfaceBorder,
                  color: activeTheme.accentHex,
                }}
                className="btn-klick w-full rounded-xl border font-bold tracking-wider text-[10.5px] font-['Orbitron',sans-serif] hover:brightness-125 active:scale-95 transition-all cursor-pointer"
              >
                {copiedUrl ? 'LINK COPIED!' : 'COPY GAME LINK'}
              </button>

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                style={{
                  backgroundColor: activeTheme.primaryBtnBg,
                  color: activeTheme.primaryBtnText,
                }}
                className="btn-klick w-full rounded-xl font-black tracking-wider text-xs font-['Orbitron',sans-serif] cursor-pointer active:scale-95 transition-all"
              >
                GOT IT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
