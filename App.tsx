import React, { useState } from 'react';
import { PuzzleSetup } from './components/PuzzleSetup';
import { PuzzleGame } from './components/PuzzleGame';
import { AppState, FrameSelectionState, GameSettings, StartGamePayload } from './types';

function App() {
  const [appState, setAppState] = useState<AppState>('MENU');
  const [menuImage, setMenuImage] = useState<HTMLImageElement | null>(null);
  const [playImage, setPlayImage] = useState<HTMLImageElement | null>(null);
  const [activeSettings, setActiveSettings] = useState<GameSettings | null>(null);
  const [lastFrameSelection, setLastFrameSelection] = useState<FrameSelectionState | null>(null);
  const [activeFrameSelection, setActiveFrameSelection] = useState<FrameSelectionState | null>(null);

  const handleStartGame = ({ playImage: nextPlayImage, sourceImage, settings, frame }: StartGamePayload) => {
    setMenuImage(sourceImage);
    setPlayImage(nextPlayImage);
    setActiveSettings(settings);
    setLastFrameSelection(frame);
    setActiveFrameSelection(frame);
    setAppState('PLAYING');
  };

  const handleExit = () => {
    setAppState('MENU');
  };

  return (
    <div className="w-full min-h-screen font-sans pb-10">
      {appState === 'MENU' && (
        <PuzzleSetup
          onStart={handleStartGame}
          initialImage={menuImage}
          initialSettings={activeSettings}
          initialFrame={lastFrameSelection}
        />
      )}

      {appState === 'PLAYING' && playImage && activeSettings && (
        <PuzzleGame
          image={playImage}
          settings={activeSettings}
          activeFrame={activeFrameSelection}
          onExit={handleExit}
        />
      )}

      <footer className="fixed bottom-0 left-0 right-0 z-[120] border-t border-[#5c3a2a] bg-[#1a110d]/92 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-2 text-xs text-[#d4b491] flex items-center justify-center gap-4">
          <a href="/about.html" className="hover:text-[#F2D086]">About</a>
          <span className="text-[#8B4513]">|</span>
          <a href="/news.html" className="hover:text-[#F2D086]">News</a>
          <span className="text-[#8B4513]">|</span>
          <a href="/privacy.html" className="hover:text-[#F2D086]">Privacy Policy</a>
          <span className="text-[#8B4513]">|</span>
          <a href="/terms.html" className="hover:text-[#F2D086]">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
