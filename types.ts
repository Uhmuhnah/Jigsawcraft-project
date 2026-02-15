export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SnapPoint {
  id: string;
  x: number;
  y: number;
}

export interface PuzzlePieceEdgeRef {
  edgeId: string;
  direction: 1 | -1;
  neighborId?: number | null;
}

export interface SharedEdgeData {
  leftPieceId: number;
  rightPieceId: number | null;
  curvePoints: Point[];
  tabProfile?: {
    center: number;
    width: number;
    amplitude: number;
  };
}

export interface PuzzlePiece {
  id: number;
  correctRow: number;
  correctCol: number;
  currentPos: Point;
  targetPos: Point;
  width: number;
  height: number;
  shape: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  tabs: {
    topPos: number;
    rightPos: number;
    bottomPos: number;
    leftPos: number;
    topVar: [number, number, number];
    rightVar: [number, number, number];
    bottomVar: [number, number, number];
    leftVar: [number, number, number];
  };
  snapPoints: SnapPoint[];
  boundary?: Point[];
  neighbors?: number[];
  edges?: PuzzlePieceEdgeRef[];

  group: number;
  isSolved: boolean;

  regionIndex: number;
  avgColor?: string;
  hsl?: [number, number, number];

  cachedSprite?: ImageBitmap | HTMLCanvasElement;
  spriteOffset?: Point;
  spriteScale?: number;
  rotationQuarter?: number;
}

export interface PuzzleGenerationResult {
  pieces: PuzzlePiece[];
  sharedEdges: Record<string, SharedEdgeData>;
}

export interface GameSettings {
  pieceCount: number;
  rotationEnabled: boolean;
  showGhost: boolean;
  snapDistance: number;
  irregularMode?: boolean;
}

export type FrameShape = 'rect' | 'circle' | 'heart' | 'diamond';

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameSelectionState {
  rect: FrameRect;
  shape: FrameShape;
}

export interface StartGamePayload {
  playImage: HTMLImageElement;
  sourceImage: HTMLImageElement;
  settings: GameSettings;
  frame: FrameSelectionState;
}

export type AppState = 'MENU' | 'PLAYING' | 'FINISHED';
