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
    <div className="w-full h-screen overflow-hidden font-sans">
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
    </div>
  );
}

export default App;
