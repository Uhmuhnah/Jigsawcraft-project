import React, { useRef, useEffect, useState, useMemo, Suspense, useCallback } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import * as THREE from 'three';
import { FrameSelectionState, GameSettings, PuzzlePiece, Point } from '../types';
import { generatePuzzlePieces, generatePuzzleSprites } from '../utils/puzzleGenerator';
import { Button } from './Button';
import { ArrowLeft, EyeOff, Loader2, SlidersHorizontal, Check, Settings2, Clock3, Download } from 'lucide-react';

interface PuzzleGameProps {
  image: HTMLImageElement;
  settings: GameSettings;
  activeFrame?: FrameSelectionState | null;
  onExit: () => void;
}

const PIECE_Z_BASE = 3;
const CAMERA_FIT_DURATION_MS = 900;
const INTRO_ANIM_MAX_PIECES = 500;
type PuzzleImageSource = HTMLImageElement | HTMLCanvasElement;
type FloorTheme = 'birch' | 'walnut' | 'soft';
type CameraFitRequest = {
    targetX: number;
    targetY: number;
    distance: number;
    version: number;
    shake?: boolean;
    durationMs?: number;
};

const formatDuration = (totalSeconds: number) => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
};

const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerpNumber = (a: number, b: number, t: number) => a + (b - a) * t;

const normalizeQuarter = (q: number) => ((q % 4) + 4) % 4;

const rotateLocalPoint = (
    x: number,
    y: number,
    w: number,
    h: number,
    quarter: number
) => {
    const q = normalizeQuarter(quarter);
    if (q === 0) return { x, y };
    const cx = w / 2;
    const cy = h / 2;
    let dx = x - cx;
    let dy = y - cy;
    for (let i = 0; i < q; i++) {
        const nextDx = dy;
        const nextDy = -dx;
        dx = nextDx;
        dy = nextDy;
    }
    return { x: cx + dx, y: cy + dy };
};

const createPreparedPuzzleImage = (src: HTMLImageElement): HTMLCanvasElement => {
    const sourceWidth = Math.max(1, src.naturalWidth || src.width);
    const sourceHeight = Math.max(1, src.naturalHeight || src.height);

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, sourceWidth, sourceHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, sourceWidth, sourceHeight);
    return canvas;
};

const buildNeighborMap = (inputPieces: PuzzlePiece[]) => {
    const snapOwners = new Map<string, number[]>();
    inputPieces.forEach((piece) => {
        piece.snapPoints.forEach((sp) => {
            const list = snapOwners.get(sp.id);
            if (list) list.push(piece.id);
            else snapOwners.set(sp.id, [piece.id]);
        });
    });

    const neighborsById = new Map<number, Set<number>>();
    inputPieces.forEach((piece) => {
        neighborsById.set(piece.id, new Set<number>());
    });

    snapOwners.forEach((owners) => {
        if (owners.length < 2) return;
        for (let i = 0; i < owners.length; i++) {
            for (let j = i + 1; j < owners.length; j++) {
                neighborsById.get(owners[i])?.add(owners[j]);
                neighborsById.get(owners[j])?.add(owners[i]);
            }
        }
    });

    const compact = new Map<number, number[]>();
    neighborsById.forEach((set, id) => {
        compact.set(id, Array.from(set));
    });
    return compact;
};

const getPieceFootprint = (piece: PuzzlePiece) => {
    // cachedSprite includes large transparent padding; use logical tile size with a small tab margin.
    return {
        width: piece.width * 1.06,
        height: piece.height * 1.06,
    };
};

const buildPuzzleShape = (piece: PuzzlePiece): THREE.Shape => {
    if (piece.boundary && piece.boundary.length >= 3) {
        const irregular = new THREE.Shape();
        const first = piece.boundary[0];
        irregular.moveTo(first.x - piece.width / 2, piece.height / 2 - first.y);
        for (let i = 1; i < piece.boundary.length; i++) {
            const p = piece.boundary[i];
            irregular.lineTo(p.x - piece.width / 2, piece.height / 2 - p.y);
        }
        irregular.closePath();
        return irregular;
    }

    const w = piece.width;
    const h = piece.height;
    const x = -w / 2;
    const y = h / 2;
    const { top, right, bottom, left } = piece.shape;
    const tabs = piece.tabs;

    const baseTabHeight = 0.25;
    const baseTabNeck = 0.22;
    const baseTabHead = 0.28;

    const shape = new THREE.Shape();
    shape.moveTo(x, y);

    if (top === 0) {
        shape.lineTo(x + w, y);
    } else {
        const [headScale, neckScale, skew] = tabs.topVar;
        const tabH = h * baseTabHeight * (top === 1 ? 1 : -1);
        const cx = x + w * tabs.topPos + w * skew;
        const neckW = w * baseTabNeck * neckScale;
        shape.lineTo(cx - neckW, y);
        shape.bezierCurveTo(
            cx - neckW, y + tabH * 0.8,
            cx - w * baseTabHead * headScale, y + tabH,
            cx, y + tabH
        );
        shape.bezierCurveTo(
            cx + w * baseTabHead * headScale, y + tabH,
            cx + neckW, y + tabH * 0.8,
            cx + neckW, y
        );
        shape.lineTo(x + w, y);
    }

    if (right === 0) {
        shape.lineTo(x + w, y - h);
    } else {
        const [headScale, neckScale, skew] = tabs.rightVar;
        const tabW = w * baseTabHeight * (right === 1 ? 1 : -1);
        const cy = y - h * tabs.rightPos - h * skew;
        const neckH = h * baseTabNeck * neckScale;
        shape.lineTo(x + w, cy + neckH);
        shape.bezierCurveTo(
            x + w + tabW * 0.8, cy + neckH,
            x + w + tabW, cy + h * baseTabHead * headScale,
            x + w + tabW, cy
        );
        shape.bezierCurveTo(
            x + w + tabW, cy - h * baseTabHead * headScale,
            x + w + tabW * 0.8, cy - neckH,
            x + w, cy - neckH
        );
        shape.lineTo(x + w, y - h);
    }

    if (bottom === 0) {
        shape.lineTo(x, y - h);
    } else {
        const [headScale, neckScale, skew] = tabs.bottomVar;
        const tabH = h * baseTabHeight * (bottom === 1 ? -1 : 1);
        const cx = x + w * tabs.bottomPos + w * skew;
        const neckW = w * baseTabNeck * neckScale;
        shape.lineTo(cx + neckW, y - h);
        shape.bezierCurveTo(
            cx + neckW, y - h + tabH * 0.8,
            cx + w * baseTabHead * headScale, y - h + tabH,
            cx, y - h + tabH
        );
        shape.bezierCurveTo(
            cx - w * baseTabHead * headScale, y - h + tabH,
            cx - neckW, y - h + tabH * 0.8,
            cx - neckW, y - h
        );
        shape.lineTo(x, y - h);
    }

    if (left === 0) {
        shape.lineTo(x, y);
    } else {
        const [headScale, neckScale, skew] = tabs.leftVar;
        const tabW = w * baseTabHeight * (left === 1 ? -1 : 1);
        const cy = y - h * tabs.leftPos - h * skew;
        const neckH = h * baseTabNeck * neckScale;
        shape.lineTo(x, cy - neckH);
        shape.bezierCurveTo(
            x + tabW * 0.8, cy - neckH,
            x + tabW, cy - h * baseTabHead * headScale,
            x + tabW, cy
        );
        shape.bezierCurveTo(
            x + tabW, cy + h * baseTabHead * headScale,
            x + tabW * 0.8, cy + neckH,
            x, cy + neckH
        );
        shape.lineTo(x, y);
    }

    shape.closePath();
    return shape;
};

// --- 3D Components ---

// 게임 테이블 / 바닥 평면 컴포넌트
// 퍼즐을 놓을 수 있는 넓은 나무 질감의 바닥을 생성합니다.
const GameTable = ({ width, height, theme }: { width: number; height: number; theme: FloorTheme }) => {
    const { gl } = useThree();
    const size = Math.max(width, height) * 15;
    const woodTexture = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const palette = theme === 'birch'
            ? {
                baseA: '#d8c4a9',
                baseB: '#cfb99c',
                baseC: '#dfccb3',
                dark: 'rgba(78,56,39,',
                light: 'rgba(235,214,188,',
            }
            : theme === 'walnut'
                ? {
                    baseA: '#8b6547',
                    baseB: '#7a563b',
                    baseC: '#926b4a',
                    dark: 'rgba(44,28,18,',
                    light: 'rgba(188,146,106,',
                }
                : {
                    baseA: '#7a5034',
                    baseB: '#6e472f',
                    baseC: '#7b5235',
                    dark: 'rgba(44,28,18,',
                    light: 'rgba(188,146,106,',
                };

        // Low-contrast, soft wood texture for eye comfort.
        const baseGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        baseGradient.addColorStop(0, palette.baseA);
        baseGradient.addColorStop(0.5, palette.baseB);
        baseGradient.addColorStop(1, palette.baseC);
        ctx.fillStyle = baseGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Broad, subtle horizontal grain bands (no sharp lines, no knots).
        for (let i = 0; i < 42; i++) {
            const t = i / 41;
            const y = t * canvas.height;
            const wave = Math.sin(t * 12.0) * 3 + Math.sin(t * 31.0 + 0.9) * 2;
            const darkAlpha = 0.015 + (i % 5) * 0.002;
            ctx.strokeStyle = `${palette.dark}${darkAlpha})`;
            ctx.lineWidth = 14;
            ctx.beginPath();
            ctx.moveTo(0, y + wave);
            ctx.lineTo(canvas.width, y + wave + Math.sin(i * 0.7) * 1.2);
            ctx.stroke();
        }

        for (let i = 0; i < 26; i++) {
            const t = i / 25;
            const y = t * canvas.height;
            const wave = Math.sin(t * 9.0 + 0.6) * 2;
            const lightAlpha = 0.01 + (i % 4) * 0.0015;
            ctx.strokeStyle = `${palette.light}${lightAlpha})`;
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.moveTo(0, y + wave);
            ctx.lineTo(canvas.width, y + wave);
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        const repeat = Math.max(2, size / 520);
        tex.repeat.set(repeat, repeat);
        tex.anisotropy = gl.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        return tex;
    }, [gl, size, theme]);

    useEffect(() => {
        return () => {
            woodTexture?.dispose();
        };
    }, [woodTexture]);

    return (
        <mesh position={[width / 2, -height / 2, -10]} receiveShadow>
            <planeGeometry args={[size, size]} />
            <meshStandardMaterial
                map={woodTexture || undefined}
                color={theme === 'birch' ? '#e5cfb5' : (theme === 'walnut' ? '#c39167' : '#cb986e')}
                roughness={theme === 'birch' ? 0.82 : 0.74}
                metalness={0.02}
            />
        </mesh>
    );
};

const PuzzleFrame = ({ width, height }: { width: number; height: number }) => {
    const frameThickness = Math.max(2, Math.min(width, height) * 0.008);
    const frameDepth = 8;
    const frameColor = "#5a1f2f";
    
    return (
        <group position={[width/2, -height/2, -2]}>
            {/* 뒷판 (Backing) */}
            <mesh position={[0, 0, 0]} receiveShadow renderOrder={10}>
                <boxGeometry args={[width, height, 1]} /> 
                <meshStandardMaterial color="#8a6b52" roughness={0.88} />
            </mesh>
            {/* 테두리 (Border) */}
            <group position={[0, 0, frameDepth/2]}>
                {/* 상단 테두리 */}
                <mesh position={[0, height/2 + frameThickness/2, 0]} castShadow receiveShadow renderOrder={11}>
                    <boxGeometry args={[width + frameThickness * 2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} roughness={0.3} />
                </mesh>
                {/* 하단 테두리 */}
                <mesh position={[0, -(height/2 + frameThickness/2), 0]} castShadow receiveShadow renderOrder={11}>
                    <boxGeometry args={[width + frameThickness * 2, frameThickness, frameDepth]} />
                    <meshStandardMaterial color={frameColor} roughness={0.3} />
                </mesh>
                {/* 좌측 테두리 */}
                <mesh position={[-(width/2 + frameThickness/2), 0, 0]} castShadow receiveShadow renderOrder={11}>
                    <boxGeometry args={[frameThickness, height, frameDepth]} />
                    <meshStandardMaterial color={frameColor} roughness={0.3} />
                </mesh>
                {/* 우측 테두리 */}
                <mesh position={[width/2 + frameThickness/2, 0, 0]} castShadow receiveShadow renderOrder={11}>
                    <boxGeometry args={[frameThickness, height, frameDepth]} />
                    <meshStandardMaterial color={frameColor} roughness={0.3} />
                </mesh>
            </group>
        </group>
    );
};

// 퍼즐 박스 3D 표현 컴포넌트
// 참조용 이미지가 그려진 박스를 3D 공간 한구석에 배치합니다.
const PuzzleBox3D = ({
    image,
    position,
    openTarget: _openTarget,
}: {
    image: PuzzleImageSource;
    position: [number, number, number];
    openTarget: number;
}) => {
    const { gl } = useThree();
    const aspect = image.width / image.height;
    const h = image.height;
    const w = h * aspect;
    const boxDepth = Math.min(w, h) * 0.2;
    const bodyH = h;
    const texture = useMemo(() => {
        const tex = new THREE.Texture(image);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = gl.capabilities.getMaxAnisotropy();
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        return tex;
    }, [image, gl]);

    return (
        <group position={position} rotation={[0, 0, 0]}>
            <mesh castShadow receiveShadow position={[0, 0, boxDepth / 2]}>
                <boxGeometry args={[w, bodyH, boxDepth]} />
                <meshStandardMaterial attach="material-0" color="#111111" roughness={0.5} />
                <meshStandardMaterial attach="material-1" color="#111111" roughness={0.5} />
                <meshStandardMaterial attach="material-2" color="#111111" roughness={0.5} />
                <meshStandardMaterial attach="material-3" color="#111111" roughness={0.5} />
                <meshStandardMaterial attach="material-4" map={texture} />
                <meshStandardMaterial attach="material-5" color="#111111" roughness={0.5} />
            </mesh>
        </group>
    );
};

// 개별 퍼즐 조각 렌더링 컴포넌트 (React.memo로 불필요한 리렌더링 방지)
const PieceMesh = React.memo(({ 
    piece, 
    isSelected, 
    onPointerDown,
    zLift,
    enableDepthMesh,
    lowQuality,
}: { 
    piece: PuzzlePiece; 
    isSelected: boolean; 
    onPointerDown: (e: ThreeEvent<PointerEvent>, p: PuzzlePiece) => void;
    zLift: number;
    enableDepthMesh: boolean;
    lowQuality: boolean;
}) => {
    const { gl } = useThree();
    
    // 미리 생성된 캐시된 스프라이트(ImageBitmap)를 텍스처로 변환
    const texture = useMemo(() => {
        if (!piece.cachedSprite) return null;
        const tex = new THREE.Texture(piece.cachedSprite);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Cutout puzzle pieces are sensitive to mip alpha collapse at mid zoom.
        // Keep linear sampling without mipmaps to avoid disappearing tiles.
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        const anisoCap = lowQuality ? 2 : 8;
        tex.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), anisoCap);
        tex.needsUpdate = true;
        return tex;
    }, [piece.cachedSprite, gl, lowQuality]);

    const spriteScale = piece.spriteScale || 1;
    const spriteW = (piece.cachedSprite?.width || piece.width) / spriteScale;
    const spriteH = (piece.cachedSprite?.height || piece.height) / spriteScale;
    
    // 스프라이트 내에서 실제 퍼즐 조각의 오프셋 보정
    const offsetX = (piece.spriteOffset?.x || 0) + spriteW / 2;
    const offsetY = (piece.spriteOffset?.y || 0) + spriteH / 2;

    // 논리적 좌표계를 3D 월드 좌표계로 변환 (Y축 반전)
    const x = piece.currentPos.x + offsetX;
    const y = -(piece.currentPos.y + offsetY);
    
    // Z-fighting 및 시각적 우선순위 처리를 위한 Z축(깊이) 설정
    // 선택된 조각은 가장 위(1)에, 해결된 조각은 바닥에 가깝게(0.05) 배치
    const z = isSelected
        ? PIECE_Z_BASE + 1
        : (piece.isSolved ? PIECE_Z_BASE : (PIECE_Z_BASE + piece.id * 0.0001));
    const depth = Math.max(0.22, Math.min(piece.width, piece.height) * 0.08);
    const rotationAngle = -(normalizeQuarter(piece.rotationQuarter || 0) * Math.PI) / 2;
    const extrudeGeometry = useMemo(() => {
        if (!enableDepthMesh) return null;
        const shape = buildPuzzleShape(piece);
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth,
            bevelEnabled: false,
            steps: 1,
            curveSegments: lowQuality ? 4 : 8,
        });
        return geo;
    }, [depth, enableDepthMesh, lowQuality, piece]);

    useEffect(() => {
        return () => {
            extrudeGeometry?.dispose();
        };
    }, [extrudeGeometry]);

    if (!texture) return null;

    return (
        <group>
            {extrudeGeometry && (
                <mesh
                    position={[x, y, z - depth]}
                    rotation={[0, 0, rotationAngle]}
                    frustumCulled={false}
                    renderOrder={1950 + zLift}
                    geometry={extrudeGeometry}
                    onPointerDown={(e) => onPointerDown(e, piece)}
                >
                    <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
                </mesh>
            )}
            {isSelected && (
                // 선택 시 바닥에 그림자 효과 표시
                <mesh position={[x, y, 1]} rotation={[0, 0, rotationAngle]} renderOrder={1900 + zLift}>
                    <planeGeometry args={[spriteW, spriteH]} />
                    <meshBasicMaterial 
                        map={texture} 
                        transparent 
                        opacity={0.3} 
                        color="#000000"
                        depthTest={false}
                        depthWrite={false}
                    />
                </mesh>
            )}
            <mesh 
                position={[x, y, z]} 
                rotation={[0, 0, rotationAngle]}
                frustumCulled={false}
                renderOrder={2000 + zLift}
                castShadow={!lowQuality}
                receiveShadow={!lowQuality}
                onPointerDown={!extrudeGeometry ? (e) => onPointerDown(e, piece) : undefined}
            >
                <planeGeometry args={[spriteW, spriteH]} />
                <meshStandardMaterial 
                    map={texture} 
                    transparent 
                    side={THREE.DoubleSide}
                    shadowSide={THREE.DoubleSide}
                    depthTest={false}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
});

// 메인 게임 씬(Logic) 컴포넌트
const GameScene = ({ 
    pieces, 
    setPieces, 
    settings,
    setSolvedCount,
    setDragState,
    boardSize,
    image,
    onPieceConnect,
    onBoxClick,
    onBoxPointerDown,
    onBoxPointerUp,
    floorTheme,
    neighborMap,
    onDragStart,
    introActive,
    introPhase,
}: { 
    pieces: PuzzlePiece[]; 
    setPieces: React.Dispatch<React.SetStateAction<PuzzlePiece[]>>;
    settings: GameSettings;
    setSolvedCount: (n: number) => void;
    setDragState: (isDragging: boolean) => void;
    boardSize: { width: number, height: number };
    image: PuzzleImageSource;
    onPieceConnect: () => void;
    onBoxClick: () => void;
    onBoxPointerDown: () => void;
    onBoxPointerUp: () => void;
    floorTheme: FloorTheme;
    neighborMap: Map<number, number[]>;
    onDragStart: () => void;
    introActive: boolean;
    introPhase: 'idle' | 'box' | 'unwrap' | 'release';
}) => {
    const { camera } = useThree();
    const boxWidth = image.width;
    const frameToBoxGap = Math.max(image.width, image.height) * 0.12;
    const boxX = -(boxWidth / 2) - frameToBoxGap;
    const boxY = -boardSize.height / 2;
    const lowQuality = pieces.length >= 1000;
    const frameIntroRef = useRef<THREE.Group>(null);
    const piecesIntroRef = useRef<THREE.Group>(null);
    const revealProgressRef = useRef(introActive ? 0 : 1);

    useEffect(() => {
        revealProgressRef.current = introActive ? 0 : 1;
    }, [introActive]);
    
    // 드래그 상태 관리
    // 단순 boolean이 아니라, 드래그 중인 그룹과 기준 조각(Anchor), 오프셋 정보를 저장합니다.
    const [dragInfo, setDragInfo] = useState<{
        pieceId: number;       // 현재 드래그 중인 조각 ID
        groupId: number;       // 현재 드래그 중인 그룹 ID
        anchorPieceId: number; // 마우스로 클릭한 기준 조각 ID (앵커)
        clickOffset: THREE.Vector3; // 클릭 지점과 앵커 조각 원점 간의 차이 벡터
    } | null>(null);

    const planeIntersectPoint = useRef(new THREE.Vector3());
    const raycaster = useRef(new THREE.Raycaster());
    const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
    const zOrderMapRef = useRef<Map<number, number>>(new Map());
    const zOrderTickRef = useRef(1);
    const [, setZOrderVersion] = useState(0);
    const dragMovedRef = useRef(false);
    const dragStartRef = useRef(new THREE.Vector2());
    const pointerUpHandledRef = useRef(false);
    const dragRafRef = useRef<number | null>(null);
    const dragAnchorTargetRef = useRef<{ x: number; y: number } | null>(null);
    const dragLayoutRef = useRef<{
        groupId: number;
        anchorPieceId: number;
        members: Array<{ index: number; offsetX: number; offsetY: number }>;
    } | null>(null);
    const boxClickArmRef = useRef<{ armed: boolean; at: number }>({ armed: false, at: 0 });

    const getZLift = (pieceId: number) => {
        return zOrderMapRef.current.get(pieceId) ?? pieceId;
    };

    useFrame((_, delta) => {
        const targetReveal = !introActive ? 1 : (introPhase === 'release' ? 1 : introPhase === 'unwrap' ? 0.2 : 0);
        revealProgressRef.current = THREE.MathUtils.damp(revealProgressRef.current, targetReveal, 6, delta);
        const t = clampNumber(revealProgressRef.current, 0, 1);

        if (frameIntroRef.current) {
            const fromFrameX = boxX - boardSize.width / 2 + 40;
            frameIntroRef.current.position.x = lerpNumber(fromFrameX, 0, t);
            frameIntroRef.current.position.z = lerpNumber(18, 0, t);
            frameIntroRef.current.rotation.z = lerpNumber(0.08, 0, t);
        }

        if (piecesIntroRef.current) {
            const fromPiecesX = boxX - (boardSize.width + Math.max(boardSize.width, boardSize.height) * 0.78);
            const fromPiecesY = 0;
            piecesIntroRef.current.position.x = lerpNumber(fromPiecesX, 0, t);
            piecesIntroRef.current.position.y = lerpNumber(fromPiecesY, 0, t);
            piecesIntroRef.current.position.z = lerpNumber(20, 0, t);
            const s = lerpNumber(0.9, 1, t);
            piecesIntroRef.current.scale.set(s, s, 1);
        }
    });

    const applyDragGroupPosition = (anchorLogicX: number, anchorLogicY: number) => {
        const layout = dragLayoutRef.current;
        if (!layout) return;

        setPieces(prev => {
            if (layout.members.length === 0) return prev;
            const next = [...prev];
            let changed = false;

            for (const member of layout.members) {
                const piece = prev[member.index];
                if (!piece || piece.group !== layout.groupId) continue;
                const nx = anchorLogicX + member.offsetX;
                const ny = anchorLogicY + member.offsetY;
                if (piece.currentPos.x === nx && piece.currentPos.y === ny) continue;
                next[member.index] = {
                    ...piece,
                    currentPos: { x: nx, y: ny },
                };
                changed = true;
            }

            return changed ? next : prev;
        });
    };

    const flushPendingDragUpdate = () => {
        if (dragRafRef.current !== null) {
            cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = null;
        }
        const anchor = dragAnchorTargetRef.current;
        if (!anchor) return;
        applyDragGroupPosition(anchor.x, anchor.y);
    };

    // 1. 드래그 시작 핸들러
    const handlePointerDown = (e: ThreeEvent<PointerEvent>, piece: PuzzlePiece) => {
        if (introActive) return;
        // 이미 보드에 고정(Solved)된 조각은 드래그 불가 (Grid Lock)
        if (piece.isSolved) return; 
        
        e.stopPropagation(); 
        onDragStart();
        dragMovedRef.current = false;
        pointerUpHandledRef.current = false;
        const clickGroupId = piece.group;
        const groupPieces = pieces.filter(p => p.group === clickGroupId);
        const nextLift = ++zOrderTickRef.current;
        groupPieces.forEach(gp => {
            zOrderMapRef.current.set(gp.id, nextLift);
        });
        setZOrderVersion(v => v + 1);

        // 3D 공간 상의 마우스 클릭 위치 계산 (Raycasting)
        raycaster.current.setFromCamera(new THREE.Vector2(e.pointer.x, e.pointer.y), camera);
        raycaster.current.ray.intersectPlane(groundPlane, planeIntersectPoint.current);
        
        // 클릭된 지점 (Visual 좌표)
        const hitX = planeIntersectPoint.current.x;
        const hitY = planeIntersectPoint.current.y;
        dragStartRef.current.set(hitX, hitY);

        // 조각의 현재 Visual 위치 계산 (Logic -> Visual 변환)
        // 로직 좌표계: Y가 아래로 증가, 3D 좌표계: Y가 위로 증가
        const visualPieceX = piece.currentPos.x;
        const visualPieceY = -piece.currentPos.y; // Y축 반전 주의

        // 마우스 클릭 지점과 조각 중심 간의 오프셋 계산
        // 이 값을 유지해야 드래그 시 조각이 마우스 커서를 따라다니는 것처럼 보입니다.
        const offsetX = hitX - visualPieceX;
        const offsetY = hitY - visualPieceY;

        const members: Array<{ index: number; offsetX: number; offsetY: number }> = [];
        for (let index = 0; index < pieces.length; index++) {
            const candidate = pieces[index];
            if (candidate.group !== piece.group) continue;
            members.push({
                index,
                offsetX: candidate.targetPos.x - piece.targetPos.x,
                offsetY: candidate.targetPos.y - piece.targetPos.y,
            });
        }
        dragLayoutRef.current = {
            groupId: piece.group,
            anchorPieceId: piece.id,
            members,
        };
        dragAnchorTargetRef.current = { x: piece.currentPos.x, y: piece.currentPos.y };

        setDragInfo({
            pieceId: piece.id,
            groupId: piece.group,
            anchorPieceId: piece.id,
            clickOffset: new THREE.Vector3(offsetX, offsetY, 0)
        });
    };

    // 2. 드래그 중 이동 핸들러 (Grid Lock System 핵심)
    // 개별 조각을 마우스 이동량(delta)만큼 움직이는 것이 아니라,
    // '앵커 조각'의 위치를 결정하고, 나머지 그룹원들은 '정답 위치'를 기준으로 상대 위치를 재계산합니다.
    // 이를 통해 부동소수점 연산 오차 누적(Drift)을 방지하고 그룹 형태를 완벽하게 유지합니다.
    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
        if (!dragInfo) return;

        raycaster.current.setFromCamera(new THREE.Vector2(e.pointer.x, e.pointer.y), camera);
        
        if (raycaster.current.ray.intersectPlane(groundPlane, planeIntersectPoint.current)) {
            const worldX = planeIntersectPoint.current.x;
            const worldY = planeIntersectPoint.current.y;
            const dragDistance = Math.hypot(
                worldX - dragStartRef.current.x,
                worldY - dragStartRef.current.y
            );
            if (!dragMovedRef.current) {
                if (dragDistance < 2.5) return;
                dragMovedRef.current = true;
                setDragState(true);
            }

            // 앵커 조각의 새로운 목표 위치 (Visual 좌표계)
            const newAnchorVisualX = worldX - dragInfo.clickOffset.x;
            const newAnchorVisualY = worldY - dragInfo.clickOffset.y;

            // Visual -> Logic 좌표계 변환
            const newAnchorLogicX = newAnchorVisualX;
            const newAnchorLogicY = -newAnchorVisualY;
            dragAnchorTargetRef.current = { x: newAnchorLogicX, y: newAnchorLogicY };
            if (dragRafRef.current === null) {
                dragRafRef.current = requestAnimationFrame(() => {
                    dragRafRef.current = null;
                    const anchor = dragAnchorTargetRef.current;
                    if (!anchor) return;
                    applyDragGroupPosition(anchor.x, anchor.y);
                });
            }
        }
    };

    const findBestNeighborMatch = (
        allPieces: PuzzlePiece[],
        movingGroupId: number
    ): {
        sourcePiece: PuzzlePiece;
        targetPiece: PuzzlePiece;
        distance: number;
        deltaX: number;
        deltaY: number;
    } | null => {
        const movingPieces = allPieces.filter(p => p.group === movingGroupId);
        if (movingPieces.length === 0) {
            return null;
        }

        let bestMatch: {
            sourcePiece: PuzzlePiece;
            targetPiece: PuzzlePiece;
            distance: number;
            deltaX: number;
            deltaY: number;
        } | null = null;
        let minDistance = Number.POSITIVE_INFINITY;

        const byId = new Map<number, PuzzlePiece>();
        allPieces.forEach((p) => byId.set(p.id, p));

        for (const sourceP of movingPieces) {
            const candidateIds = neighborMap.get(sourceP.id) || [];
            for (const targetId of candidateIds) {
                const targetP = byId.get(targetId);
                if (!targetP || targetP.group === movingGroupId) continue;

                const sourceSnapById = new Map(sourceP.snapPoints.map(sp => [sp.id, sp]));
                const sharedPairs: Array<{ sx: number; sy: number; tx: number; ty: number }> = [];
                const sourceRot = normalizeQuarter(sourceP.rotationQuarter || 0);
                const targetRot = normalizeQuarter(targetP.rotationQuarter || 0);
                if (sourceRot !== targetRot) continue;

                for (const tSnap of targetP.snapPoints) {
                    const sSnap = sourceSnapById.get(tSnap.id);
                    if (!sSnap) continue;
                    const rs = rotateLocalPoint(sSnap.x, sSnap.y, sourceP.width, sourceP.height, sourceRot);
                    const rt = rotateLocalPoint(tSnap.x, tSnap.y, targetP.width, targetP.height, targetRot);

                    sharedPairs.push({
                        sx: sourceP.currentPos.x + rs.x,
                        sy: sourceP.currentPos.y + rs.y,
                        tx: targetP.currentPos.x + rt.x,
                        ty: targetP.currentPos.y + rt.y,
                    });
                }
                // 인접 조각은 같은 ID 모서리 점을 최소 2개 공유해야 함
                if (sharedPairs.length < 2) continue;

                const pointDeltas = sharedPairs
                    .map(pair => {
                        const dx = pair.tx - pair.sx;
                        const dy = pair.ty - pair.sy;
                        return { dx, dy, dist: Math.hypot(dx, dy) };
                    })
                    .sort((a, b) => a.dist - b.dist);

                const first = pointDeltas[0];
                const second = pointDeltas[1];
                if (!first || !second) continue;

                // 두 점 모두 가까워야 붙이고, 두 점 이동량도 서로 비슷해야 함
                const minEdge = Math.min(sourceP.width, sourceP.height);
                const pointTolerance = Math.max(settings.snapDistance * 1.6, minEdge * 0.24);
                const consistencyTolerance = Math.max(settings.snapDistance, minEdge * 0.12);
                const consistency = Math.hypot(first.dx - second.dx, first.dy - second.dy);

                if (first.dist > pointTolerance || second.dist > pointTolerance) {
                    continue;
                }
                if (consistency > consistencyTolerance) continue;

                const avgDeltaX = (first.dx + second.dx) / 2;
                const avgDeltaY = (first.dy + second.dy) / 2;

                // 두 점 오차 + 일관성 오차를 함께 최소화
                const score = Math.max(first.dist, second.dist) + consistency * 0.5;
                if (score < minDistance) {
                    minDistance = score;
                    bestMatch = {
                        sourcePiece: sourceP,
                        targetPiece: targetP,
                        distance: score,
                        deltaX: avgDeltaX,
                        deltaY: avgDeltaY,
                    };
                }
            }
        }

        return bestMatch;
    };

    const isBorderPiece = (piece: PuzzlePiece) => {
        if (piece.edges && piece.edges.length > 0) {
            return piece.edges.some((edge) => edge.neighborId == null);
        }
        return (
            piece.shape.top === 0 ||
            piece.shape.bottom === 0 ||
            piece.shape.left === 0 ||
            piece.shape.right === 0
        );
    };

    const tryLockGroupToFrame = (
        allPieces: PuzzlePiece[],
        movingGroupId: number
    ): boolean => {
        const movingGroup = allPieces.filter(p => p.group === movingGroupId && !p.isSolved);
        if (movingGroup.length === 0) return false;

        const borderCandidates = movingGroup.filter(isBorderPiece);
        if (borderCandidates.length === 0) return false;
        if (movingGroup.some(piece => normalizeQuarter(piece.rotationQuarter || 0) !== 0)) return false;

        let bestPiece: PuzzlePiece | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const piece of borderCandidates) {
            const dx = piece.targetPos.x - piece.currentPos.x;
            const dy = piece.targetPos.y - piece.currentPos.y;
            const dist = Math.hypot(dx, dy);
            if (dist < bestDist) {
                bestDist = dist;
                bestPiece = piece;
            }
        }

        if (!bestPiece) return false;
        const lockThreshold = Math.max(settings.snapDistance * 1.3, Math.min(bestPiece.width, bestPiece.height) * 0.18);
        if (bestDist > lockThreshold) return false;

        const deltaX = bestPiece.targetPos.x - bestPiece.currentPos.x;
        const deltaY = bestPiece.targetPos.y - bestPiece.currentPos.y;
        movingGroup.forEach(piece => {
            piece.currentPos.x += deltaX;
            piece.currentPos.y += deltaY;
            piece.isSolved = true;
            piece.group = -1;
        });

        return true;
    };

    const mergeMovingGroupIntoTargetGroup = (
        allPieces: PuzzlePiece[],
        movingGroupId: number,
        deltaX: number,
        deltaY: number,
        targetPiece: PuzzlePiece
    ): number => {
        const nextGroupId = targetPiece.group;

        allPieces.forEach(piece => {
            if (piece.group !== movingGroupId) return;

            piece.currentPos.x += deltaX;
            piece.currentPos.y += deltaY;
            piece.group = nextGroupId;
        });

        return nextGroupId;
    };

    // 3. 드래그 종료 및 스냅 핸들러 (Union Merge System)
    const handlePointerUp = () => {
        if (!dragInfo || pointerUpHandledRef.current) return;
        pointerUpHandledRef.current = true;
        flushPendingDragUpdate();

        if (settings.rotationEnabled && !dragMovedRef.current) {
            setPieces(prev => {
                const groupCount = prev.filter(p => p.group === dragInfo.groupId).length;
                if (groupCount !== 1) return prev;
                return prev.map(p => {
                    if (p.id !== dragInfo.anchorPieceId || p.isSolved) return p;
                    return {
                        ...p,
                        rotationQuarter: normalizeQuarter((p.rotationQuarter || 0) + 1),
                    };
                });
            });
            setDragInfo(null);
            dragLayoutRef.current = null;
            dragAnchorTargetRef.current = null;
            setDragState(false);
            return;
        }
        
        setPieces(prev => {
            const currentPieces = [...prev];
            // 드래그 중이었던 그룹의 조각들 추출
            const dragGroupPieces = currentPieces.filter(p => p.group === dragInfo.groupId);
            
            if (dragGroupPieces.length === 0) return prev;

            let snappedOrMerged = false;
            const lockedToFrame = tryLockGroupToFrame(currentPieces, dragInfo.groupId);
            if (lockedToFrame) {
                snappedOrMerged = true;
            }

            // 프레임 락이 안 걸렸을 때만 조각 간 스냅 수행
            if (!lockedToFrame) {
                const bestMatch = findBestNeighborMatch(currentPieces, dragInfo.groupId);
                if (bestMatch) {
                    const mergedGroupId = mergeMovingGroupIntoTargetGroup(
                        currentPieces,
                        dragInfo.groupId,
                        bestMatch.deltaX,
                        bestMatch.deltaY,
                        bestMatch.targetPiece
                    );
                    snappedOrMerged = true;
                    if (tryLockGroupToFrame(currentPieces, mergedGroupId)) {
                        snappedOrMerged = true;
                    }
                }
            }

            // 완료 조건은 반드시 프레임 락(isSolved) 상태로만 인정한다.

            if (snappedOrMerged) {
                onPieceConnect();
            }

            return currentPieces;
        });

        setDragInfo(null);
        dragLayoutRef.current = null;
        dragAnchorTargetRef.current = null;
        setDragState(false);
    };

    // 해결된 조각 수 카운트 (승리 조건 체크용)
    useEffect(() => {
        const solved = pieces.filter(p => p.isSolved).length;
        if (solved === pieces.length) {
            setSolvedCount(solved);
            return;
        }

        const groupSize = new Map<number, number>();
        pieces.forEach((p) => {
            groupSize.set(p.group, (groupSize.get(p.group) || 0) + 1);
        });
        const connectedCount = pieces.filter((p) => (groupSize.get(p.group) || 0) > 1).length;
        const progressCount = Math.max(solved, Math.min(Math.max(0, pieces.length - 1), connectedCount));
        setSolvedCount(progressCount);
    }, [pieces, setSolvedCount]);

    useEffect(() => {
        return () => {
            if (dragRafRef.current !== null) {
                cancelAnimationFrame(dragRafRef.current);
                dragRafRef.current = null;
            }
        };
    }, []);

    return (
        <>
            <ambientLight intensity={0.45} />
            <directionalLight 
                position={[700, -500, 1200]} 
                intensity={1.0} 
                castShadow={!lowQuality}
                shadow-bias={-0.0005} 
                shadow-mapSize-width={lowQuality ? 1024 : 2048}
                shadow-mapSize-height={lowQuality ? 1024 : 2048}
            />
            <directionalLight position={[-500, 300, 800]} intensity={0.35} />

            <group onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
                {/* 드래그 이벤트를 화면 전체에서 감지하기 위한 보이지 않는 평면 */}
                <mesh visible={false} onPointerUp={handlePointerUp} position={[0,0,0]}>
                    <planeGeometry args={[50000, 50000]} />
                    <meshBasicMaterial />
                </mesh>

                <group ref={frameIntroRef}>
                    <PuzzleFrame width={boardSize.width} height={boardSize.height} />
                </group>
                <group
                    onPointerDown={(e) => {
                        if (introActive) return;
                        e.stopPropagation();
                        boxClickArmRef.current = { armed: true, at: performance.now() };
                        onBoxPointerDown();
                    }}
                    onPointerUp={(e) => {
                        if (introActive) return;
                        e.stopPropagation();
                        onBoxPointerUp();
                    }}
                    onPointerLeave={() => {
                        boxClickArmRef.current = { armed: false, at: 0 };
                        onBoxPointerUp();
                    }}
                    onClick={(e) => {
                        if (introActive) return;
                        e.stopPropagation();
                        const arm = boxClickArmRef.current;
                        const isIntentionalClick = arm.armed && performance.now() - arm.at < 700;
                        boxClickArmRef.current = { armed: false, at: 0 };
                        if (!isIntentionalClick) return;
                        onBoxClick();
                    }}
                >
                    <PuzzleBox3D
                        image={image}
                        position={[boxX, boxY, 30]}
                        openTarget={introActive ? (introPhase === 'box' ? 0 : 1) : 0}
                    />
                </group>

                <group ref={piecesIntroRef}>
                    {pieces.map(p => (
                        <PieceMesh
                            key={p.id}
                            piece={p}
                            isSelected={dragInfo?.anchorPieceId === p.id}
                            onPointerDown={handlePointerDown}
                            zLift={getZLift(p.id)}
                            enableDepthMesh={!lowQuality}
                            lowQuality={lowQuality}
                        />
                    ))}
                </group>

                <GameTable width={boardSize.width} height={boardSize.height} theme={floorTheme} />
            </group>
        </>
    );
};

const CameraReset = ({
    targetX,
    targetY,
    targetZ,
    z,
    controlsRef,
}: {
    targetX: number;
    targetY: number;
    targetZ: number;
    z: number;
    controlsRef?: React.MutableRefObject<any>;
}) => {
    const { camera } = useThree();
    const hasInitialized = useRef(false);

    useEffect(() => {
        if (hasInitialized.current) return;
        hasInitialized.current = true;
        camera.up.set(0, 1, 0);
        camera.position.set(targetX, targetY, z);
        camera.lookAt(targetX, targetY, targetZ);
        if (controlsRef?.current) {
            controlsRef.current.target.set(targetX, targetY, targetZ);
            controlsRef.current.update();
        }
        camera.updateProjectionMatrix();
    }, [camera, controlsRef, targetX, targetY, targetZ, z]);

    return null;
};

const CameraFitController = ({
    fitRequest,
    controlsRef,
    durationMs,
    stopToken,
}: {
    fitRequest: CameraFitRequest | null;
    controlsRef: React.MutableRefObject<any>;
    durationMs: number;
    stopToken: number;
}) => {
    const { camera } = useThree();
    const fitAnimRef = useRef<number | null>(null);

    useEffect(() => {
        if (!fitRequest) {
            if (fitAnimRef.current !== null) {
                cancelAnimationFrame(fitAnimRef.current);
                fitAnimRef.current = null;
            }
            return;
        }

        if (fitAnimRef.current !== null) {
            cancelAnimationFrame(fitAnimRef.current);
            fitAnimRef.current = null;
        }

        const startPos = camera.position.clone();
        const startTarget = controlsRef.current?.target?.clone?.() ?? new THREE.Vector3(0, 0, 0);
        const targetPos = new THREE.Vector3(fitRequest.targetX, fitRequest.targetY, fitRequest.distance);
        const targetTarget = new THREE.Vector3(fitRequest.targetX, fitRequest.targetY, 0);
        const startedAt = performance.now();
        const activeDurationMs = Math.max(1, fitRequest.durationMs ?? durationMs);

        const tick = (now: number) => {
            const t = Math.min(1, (now - startedAt) / activeDurationMs);
            const eased = 1 - Math.pow(1 - t, 3);
            const baseX = startPos.x + (targetPos.x - startPos.x) * eased;
            const baseY = startPos.y + (targetPos.y - startPos.y) * eased;
            const baseZ = startPos.z + (targetPos.z - startPos.z) * eased;
            const baseTargetX = startTarget.x + (targetTarget.x - startTarget.x) * eased;
            const baseTargetY = startTarget.y + (targetTarget.y - startTarget.y) * eased;
            const baseTargetZ = startTarget.z + (targetTarget.z - startTarget.z) * eased;

            const elapsed = now - startedAt;
            const shakeWindow = Math.max(160, activeDurationMs * 0.52);
            const shakeProgress = fitRequest.shake
                ? Math.max(0, 1 - Math.min(1, elapsed / shakeWindow))
                : 0;
            const shakeAmount = Math.max(0, fitRequest.distance * 0.015 * shakeProgress * shakeProgress);
            const phase = elapsed * 0.042;
            const jitterX = shakeAmount * Math.sin(phase * 2.8);
            const jitterY = shakeAmount * 0.7 * Math.cos(phase * 3.4);
            const jitterTargetX = jitterX * 0.35;
            const jitterTargetY = jitterY * 0.35;

            camera.position.set(baseX + jitterX, baseY + jitterY, baseZ);

            if (controlsRef.current) {
                controlsRef.current.target.set(
                    baseTargetX + jitterTargetX,
                    baseTargetY + jitterTargetY,
                    baseTargetZ
                );
                controlsRef.current.update();
            } else {
                camera.lookAt(baseTargetX + jitterTargetX, baseTargetY + jitterTargetY, baseTargetZ);
            }

            camera.updateProjectionMatrix();
            if (t < 1) {
                fitAnimRef.current = requestAnimationFrame(tick);
            } else {
                fitAnimRef.current = null;
            }
        };

        fitAnimRef.current = requestAnimationFrame(tick);
    }, [camera, controlsRef, durationMs, fitRequest]);

    useEffect(() => {
        if (fitAnimRef.current !== null) {
            cancelAnimationFrame(fitAnimRef.current);
            fitAnimRef.current = null;
        }
    }, [stopToken]);

    useEffect(() => {
        return () => {
            if (fitAnimRef.current !== null) {
                cancelAnimationFrame(fitAnimRef.current);
                fitAnimRef.current = null;
            }
        };
    }, []);

    return null;
};


// --- UI Components ---

export const PuzzleGame: React.FC<PuzzleGameProps> = ({ image, settings, activeFrame = null, onExit }) => {
  const boardImage = useMemo(() => createPreparedPuzzleImage(image), [image]);
  const boardWidth = boardImage.width;
  const boardHeight = boardImage.height;
  const cameraFovDeg = 40;
  const cameraFovRad = (cameraFovDeg * Math.PI) / 180;
  const topUiSafePx = 72;
  const viewportInnerW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const viewportInnerH = typeof window !== 'undefined' ? window.innerHeight : 1080;
  const visibleViewportH = Math.max(1, viewportInnerH - topUiSafePx);
  const viewportAspect = Math.max(0.5, viewportInnerW / visibleViewportH);
  const verticalOcclusionScale = viewportInnerH / visibleViewportH;
  const frameScale = activeFrame ? Math.max(activeFrame.rect.w, activeFrame.rect.h) : 1;
  const cameraScale = clampNumber(frameScale, 0.45, 1);
  const defaultCameraZ = Math.max(boardWidth, boardHeight) * 1.15 * cameraScale;
  const fitZByHeight = (boardHeight * 0.56 * verticalOcclusionScale) / Math.tan(cameraFovRad / 2);
  const fitZByWidth = (boardWidth * 0.56) / (Math.tan(cameraFovRad / 2) * viewportAspect);
  const portraitFitCameraZ = Math.max(fitZByHeight, fitZByWidth) * 1.16;
  const cameraZ = boardHeight > boardWidth
    ? Math.max(defaultCameraZ, portraitFitCameraZ)
    : defaultCameraZ;
  const farPlane = Math.max(boardWidth, boardHeight) * 12;
  const minZoomDistance = Math.max(80, Math.min(boardWidth, boardHeight) * 0.18);
  const maxZoomDistance = Math.max(cameraZ * 2.2, farPlane * 0.55);
  const boxWidthForCamera = boardWidth;
  const frameToBoxGapForCamera = Math.max(boardWidth, boardHeight) * 0.12;
  const boxFocusX = -(boxWidthForCamera / 2) - frameToBoxGapForCamera;
  const boxFocusY = -boardHeight / 2;
  const timeStorageKey = useMemo(
    () => `puzzle-time-v1:${settings.pieceCount}:${settings.irregularMode ? 'irregular' : 'grid'}:${boardWidth}x${boardHeight}`,
    [settings.pieceCount, settings.irregularMode, boardWidth, boardHeight]
  );
  const [pieces, setPieces] = useState<PuzzlePiece[]>([]);
  const [neighborMap, setNeighborMap] = useState<Map<number, number[]>>(new Map());
  const [solvedCount, setSolvedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [isSpriteStreaming, setIsSpriteStreaming] = useState(false);
  const [spriteReadyCount, setSpriteReadyCount] = useState(0);
  const [totalPieceCount, setTotalPieceCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isBoxInteracting, setIsBoxInteracting] = useState(false);
  const [showBox, setShowBox] = useState(false); 
  const [showIntroCinematic, setShowIntroCinematic] = useState(false);
  const [introPhase, setIntroPhase] = useState<'idle' | 'box' | 'unwrap' | 'release'>('idle');
  const introTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generationIdRef = useRef(0);
  
  // 알림 메시지 상태 (예: "Connected!")
  const [notification, setNotification] = useState<string | null>(null);
  const notificationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePieceConnect = () => {
      if (notificationTimeout.current) clearTimeout(notificationTimeout.current);
      setNotification("Pieces connected!");
      notificationTimeout.current = setTimeout(() => {
          setNotification(null);
      }, 2000);
  };
  
  // 정렬 메뉴 상태
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [floorTheme, setFloorTheme] = useState<FloorTheme>('birch');
  const [fitViewRequest, setFitViewRequest] = useState<CameraFitRequest | null>(null);
  const [cameraFitStopToken, setCameraFitStopToken] = useState(0);
  const [boxZoomTriggered, setBoxZoomTriggered] = useState(false);
  const [isInitialCameraMoveRunning, setIsInitialCameraMoveRunning] = useState(false);
  const boxComboRef = useRef({ count: 0, lastAt: 0 });
  const cameraIntroTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const controlsRef = useRef<any>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalTimeSec, setFinalTimeSec] = useState<number | null>(null);
  const [bestTimeSec, setBestTimeSec] = useState<number | null>(null);
  const [lastTimeSec, setLastTimeSec] = useState<number | null>(null);
  const [isSortAnimating, setIsSortAnimating] = useState(false);
  const sortAnimationFrame = useRef<number | null>(null);
  const playedCameraIntroGenerationRef = useRef(0);
  const [sortOptions, setSortOptions] = useState({
    color: true,
    border: false,
    region: false
  });
  const selectSortOption = (key: 'color' | 'border' | 'region') => {
    setSortOptions({
      color: key === 'color',
      border: key === 'border',
      region: key === 'region',
    });
  };
  const heavyPieceMode = settings.pieceCount >= 1000;
  const clearCameraIntroTimers = useCallback(() => {
    cameraIntroTimersRef.current.forEach((t) => clearTimeout(t));
    cameraIntroTimersRef.current = [];
    setIsInitialCameraMoveRunning(false);
  }, []);
  const playInitialCameraMove = useCallback(() => {
    clearCameraIntroTimers();
    setIsInitialCameraMoveRunning(true);
    const frameTargetX = boardWidth / 2;
    const frameTargetY = -boardHeight / 2;
    const isUltraHeavy = settings.pieceCount >= 2000;
    const firstDistance = Math.min(maxZoomDistance, Math.max(minZoomDistance, cameraZ));
    const zoomScale = isUltraHeavy ? 1.12 : 1.22;
    const secondDistance = Math.min(maxZoomDistance, Math.max(minZoomDistance, cameraZ * zoomScale));
    const initialDelay = isUltraHeavy ? 700 : 1000;
    const moveToFrameDuration = isUltraHeavy ? 1800 : 3600;
    const zoomOutDuration = isUltraHeavy ? 900 : 1800;

    cameraIntroTimersRef.current.push(
      setTimeout(() => {
        setFitViewRequest({
          targetX: frameTargetX,
          targetY: frameTargetY,
          distance: firstDistance,
          version: Date.now(),
          durationMs: moveToFrameDuration,
        });

        cameraIntroTimersRef.current.push(
          setTimeout(() => {
            setFitViewRequest({
              targetX: frameTargetX,
              targetY: frameTargetY,
              distance: secondDistance,
              version: Date.now() + 1,
              durationMs: zoomOutDuration,
            });
          }, moveToFrameDuration + 80)
        );
      }, initialDelay)
    );

    cameraIntroTimersRef.current.push(
      setTimeout(() => {
        setIsInitialCameraMoveRunning(false);
      }, initialDelay + moveToFrameDuration + 80 + zoomOutDuration + 120)
    );
  }, [boardHeight, boardWidth, cameraZ, clearCameraIntroTimers, maxZoomDistance, minZoomDistance, settings.pieceCount]);
  const buildFitRequest = useCallback((inputPieces: PuzzlePiece[], shake = false): CameraFitRequest => {
    let minX = 0;
    let maxX = boardWidth;
    let minY = 0;
    let maxY = boardHeight;

    for (const piece of inputPieces) {
      const footprint = getPieceFootprint(piece);
      const halfW = footprint.width * 0.55;
      const halfH = footprint.height * 0.55;
      minX = Math.min(minX, piece.currentPos.x - halfW);
      maxX = Math.max(maxX, piece.currentPos.x + halfW);
      minY = Math.min(minY, piece.currentPos.y - halfH);
      maxY = Math.max(maxY, piece.currentPos.y + halfH);
    }

    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const viewportAspect = Math.max(0.5, window.innerWidth / Math.max(1, window.innerHeight));
    const fovRad = (40 * Math.PI) / 180;
    const fitByHeight = worldHeight / (2 * Math.tan(fovRad / 2));
    const fitByWidth = worldWidth / (2 * Math.tan(fovRad / 2) * viewportAspect);
    const fitDistance = Math.max(fitByHeight, fitByWidth) * 1.3;
    const clampedDistance = Math.min(maxZoomDistance, Math.max(minZoomDistance, fitDistance));

    return {
      targetX: centerX,
      targetY: -centerY,
      distance: clampedDistance,
      version: Date.now(),
      shake,
    };
  }, [boardHeight, boardWidth, maxZoomDistance, minZoomDistance]);

  const handleReferenceToggle = useCallback(() => {
    const wasOpen = showBox;
    setShowBox(prev => !prev);

    // Only arm combo clicks after the user has intentionally opened the reference once.
    if (!wasOpen) return;
    if (isLoading || showIntroCinematic || boxZoomTriggered) return;

    const now = performance.now();
    const combo = boxComboRef.current;
    combo.count = now - combo.lastAt <= 1600 ? combo.count + 1 : 1;
    combo.lastAt = now;

    if (combo.count >= 4) {
      combo.count = 0;
      setBoxZoomTriggered(true);
      setFitViewRequest(buildFitRequest(pieces, true));
    }
  }, [boxZoomTriggered, buildFitRequest, isLoading, pieces, showBox, showIntroCinematic]);

  const isCompleted = pieces.length > 0 && pieces.every(p => p.isSolved);
  const clearIntroTimers = useCallback(() => {
    introTimersRef.current.forEach((timer) => clearTimeout(timer));
    introTimersRef.current = [];
  }, []);
  const finishIntro = useCallback(() => {
    clearIntroTimers();
    setShowIntroCinematic(false);
    setIntroPhase('idle');
  }, [clearIntroTimers]);
  const playIntroSequence = useCallback(() => {
    if (settings.pieceCount > INTRO_ANIM_MAX_PIECES) {
      finishIntro();
      return;
    }

    clearIntroTimers();
    setShowIntroCinematic(true);
    setIntroPhase('box');
    introTimersRef.current.push(setTimeout(() => setIntroPhase('unwrap'), 280));
    introTimersRef.current.push(setTimeout(() => setIntroPhase('release'), 760));
    introTimersRef.current.push(setTimeout(() => {
      setShowIntroCinematic(false);
      setIntroPhase('idle');
      clearIntroTimers();
    }, 1800));
  }, [clearIntroTimers, finishIntro, settings.pieceCount]);

  useEffect(() => {
    const raw = localStorage.getItem(timeStorageKey);
    if (!raw) {
      setBestTimeSec(null);
      setLastTimeSec(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { best?: number; last?: number };
      setBestTimeSec(typeof parsed.best === 'number' ? parsed.best : null);
      setLastTimeSec(typeof parsed.last === 'number' ? parsed.last : null);
    } catch {
      setBestTimeSec(null);
      setLastTimeSec(null);
    }
  }, [timeStorageKey]);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, 25000);

    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    if (totalPieceCount <= 0) return;
    if (isSpriteStreaming) return;
    if (spriteReadyCount < totalPieceCount) return;
    setIsLoading(false);
  }, [isLoading, isSpriteStreaming, spriteReadyCount, totalPieceCount]);

  useEffect(() => {
    if (isLoading) return;
    if (totalPieceCount <= 0) return;
    if (isSpriteStreaming) return;
    if (spriteReadyCount < totalPieceCount) return;

    const generationId = generationIdRef.current;
    if (playedCameraIntroGenerationRef.current === generationId) return;
    playedCameraIntroGenerationRef.current = generationId;
    playInitialCameraMove();
  }, [isLoading, isSpriteStreaming, playInitialCameraMove, spriteReadyCount, totalPieceCount]);

  useEffect(() => {
    return () => {
      clearIntroTimers();
    };
  }, [clearIntroTimers]);

  useEffect(() => {
    // Keep the very first view centered on the box before intro camera move starts.
    if (!isLoading || fitViewRequest || !controlsRef.current) return;
    controlsRef.current.target.set(boxFocusX, boxFocusY, 0);
    controlsRef.current.update();
  }, [boxFocusX, boxFocusY, fitViewRequest, isLoading]);

  useEffect(() => {
    if (isLoading || isInitialCameraMoveRunning || isCompleted || showIntroCinematic) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isInitialCameraMoveRunning, isLoading, isCompleted, showIntroCinematic]);

  useEffect(() => {
    if (!isCompleted || finalTimeSec !== null) return;
    const completedSec = elapsedSeconds;
    setFinalTimeSec(completedSec);
    const nextBest = bestTimeSec === null ? completedSec : Math.min(bestTimeSec, completedSec);
    setBestTimeSec(nextBest);
    setLastTimeSec(completedSec);
    localStorage.setItem(
      timeStorageKey,
      JSON.stringify({
        best: nextBest,
        last: completedSec,
      })
    );
  }, [bestTimeSec, elapsedSeconds, finalTimeSec, isCompleted, timeStorageKey]);

  // 게임 초기화 및 퍼즐 조각 생성
  useEffect(() => {
    const initPuzzle = async () => {
        const generationId = ++generationIdRef.current;
        const isStale = () => generationIdRef.current !== generationId;

        finishIntro();
        setIsLoading(true);
        setLoadingTimedOut(false);
        setIsSpriteStreaming(false);
        setSpriteReadyCount(0);
        setTotalPieceCount(0);
        setFitViewRequest(null);
        setCameraFitStopToken(prev => prev + 1);
        setElapsedSeconds(0);
        setFinalTimeSec(null);
        setShowBox(false);
        setBoxZoomTriggered(false);
        boxComboRef.current = { count: 0, lastAt: 0 };
        clearCameraIntroTimers();
        playedCameraIntroGenerationRef.current = 0;

        try {
        let cols: number, rows: number;

        // ??? ??? ??? ???????
        if (settings.pieceCount === 50) {
            const side = Math.round(Math.sqrt(settings.pieceCount));
            cols = side; rows = side;
        } else {
            const aspectRatio = boardWidth / boardHeight;
            const totalPieces = settings.pieceCount;
            cols = Math.round(Math.sqrt(totalPieces * aspectRatio));
            rows = Math.round(totalPieces / cols);
        }

        // ??? ??? ?????(??? ????? ???) ??? ???
        let { pieces: generatedPieces } = generatePuzzlePieces(boardWidth, boardHeight, rows, cols, {
            irregularMode: !!settings.irregularMode,
        });
        if (settings.rotationEnabled) {
            generatedPieces = generatedPieces.map(piece => ({
                ...piece,
                rotationQuarter: Math.floor(Math.random() * 4),
            }));
        } else {
            generatedPieces = generatedPieces.map(piece => ({
                ...piece,
                rotationQuarter: 0,
            }));
        }

        // ?????? ??????????? ??? ??? (??? ???)
        const boardW = boardWidth;
        const boardH = boardHeight;
        const maxPieceW = Math.max(...generatedPieces.map(p => p.width));
        const maxPieceH = Math.max(...generatedPieces.map(p => p.height));
        const gapX = maxPieceW * 1.18;
        const gapY = maxPieceH * 1.18;
        const sideMargin = maxPieceW * 0.7;

        // ?????? ?????? ??????????????????????????.
        for (let i = generatedPieces.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [generatedPieces[i], generatedPieces[j]] = [generatedPieces[j], generatedPieces[i]];
        }

        const placeOutsideRight = (list: PuzzlePiece[]) => {
            if (list.length === 0) return;

            const colsPerSide = Math.max(1, Math.ceil(Math.sqrt(list.length)));
            const rowsPerSide = Math.ceil(list.length / colsPerSide);
            const startY = boardH / 2 - ((rowsPerSide - 1) * gapY) / 2;

            list.forEach((p, idx) => {
                const row = Math.floor(idx / colsPerSide);
                const col = idx % colsPerSide;
                const x = boardW + sideMargin + col * gapX;
                const y = startY + row * gapY;

                p.currentPos = { x, y };
            });
        };

        placeOutsideRight(generatedPieces);

        if (isStale()) return;

        setTotalPieceCount(generatedPieces.length);
        setPieces(generatedPieces);
        setNeighborMap(buildNeighborMap(generatedPieces));

        if (generatedPieces.length === 0) {
            setIsLoading(false);
            return;
        }

        const applySpriteChunk = (chunkWithSprites: PuzzlePiece[]) => {
            const byId = new Map(chunkWithSprites.map(piece => [piece.id, piece]));
            setPieces(prev => prev.map(piece => byId.get(piece.id) ?? piece));
        };

        const qualitySpriteScale =
            settings.pieceCount >= 1800 ? 0.65 :
            settings.pieceCount >= 1200 ? 0.75 :
            settings.pieceCount >= 900 ? 0.9 :
            Math.min(2, Math.max(1, window.devicePixelRatio || 1));

        // Stability-first mode: use full generation flow for all piece counts.
        const useLegacyLargeLoad = true;
        if (useLegacyLargeLoad) {
            const allWithSprites = await generatePuzzleSprites(generatedPieces, boardImage, { spriteScale: qualitySpriteScale });
            if (isStale()) return;
            setPieces(allWithSprites);
            setSpriteReadyCount(allWithSprites.length);
            setIsSpriteStreaming(false);
            finishIntro();
            return;
        }

        const firstChunkSize = Math.max(1, Math.min(24, generatedPieces.length));
        const firstChunk = generatedPieces.slice(0, firstChunkSize);
        const firstWithSprites = await generatePuzzleSprites(firstChunk, boardImage, { spriteScale: qualitySpriteScale });
        if (isStale()) return;
        applySpriteChunk(firstWithSprites);
        setSpriteReadyCount(firstWithSprites.length);
        finishIntro();

        const chunkSize = settings.pieceCount >= 1500 ? 24 : settings.pieceCount >= 700 ? 40 : 64;
        setIsSpriteStreaming(generatedPieces.length > firstChunkSize);

        for (let i = firstChunkSize; i < generatedPieces.length; i += chunkSize) {
            const chunk = generatedPieces.slice(i, i + chunkSize);
            const chunkWithSprites = await generatePuzzleSprites(chunk, boardImage, { spriteScale: qualitySpriteScale });
            if (isStale()) return;
            applySpriteChunk(chunkWithSprites);
            setSpriteReadyCount(prev => Math.min(generatedPieces.length, prev + chunkWithSprites.length));
        }

        if (isStale()) return;
        setIsSpriteStreaming(false);
        } catch (error) {
            if (!isStale()) {
                console.error('[INIT] puzzle generation failed', error);
                let fallbackSucceeded = false;
                try {
                    // Last-resort fallback: legacy full generation with conservative scale.
                    const aspectRatio = boardWidth / boardHeight;
                    const totalPieces = settings.pieceCount;
                    const cols = settings.pieceCount === 50
                        ? Math.round(Math.sqrt(settings.pieceCount))
                        : Math.round(Math.sqrt(totalPieces * aspectRatio));
                    const rows = settings.pieceCount === 50
                        ? cols
                        : Math.round(totalPieces / cols);
                    let fallbackPieces: PuzzlePiece[] = generatePuzzlePieces(boardWidth, boardHeight, rows, cols, {
                        irregularMode: !!settings.irregularMode,
                    }).pieces.map(piece => ({
                        ...piece,
                        rotationQuarter: settings.rotationEnabled ? Math.floor(Math.random() * 4) : 0,
                    }));
                    fallbackPieces = await generatePuzzleSprites(fallbackPieces, boardImage, { spriteScale: 0.75 });
                    if (isStale()) return;
                    setPieces(fallbackPieces);
                    setNeighborMap(buildNeighborMap(fallbackPieces));
                    setSpriteReadyCount(fallbackPieces.length);
                    setTotalPieceCount(fallbackPieces.length);
                    fallbackSucceeded = true;
                } catch (fallbackError) {
                    console.error('[INIT] fallback generation failed', fallbackError);
                }
                setIsSpriteStreaming(false);
                if (!fallbackSucceeded) {
                    setIsLoading(false);
                }
                finishIntro();
            }
        }
    };

    initPuzzle();

    return () => {
        generationIdRef.current += 1;
    };
  }, [boardHeight, boardImage, boardWidth, clearCameraIntroTimers, finishIntro, playInitialCameraMove, settings]);

  useEffect(() => {
    return () => {
        clearCameraIntroTimers();
        if (sortAnimationFrame.current !== null) {
            cancelAnimationFrame(sortAnimationFrame.current);
            sortAnimationFrame.current = null;
        }
    };
  }, [clearCameraIntroTimers]);

  // 퍼즐 조각 정렬 기능 (색상, 테두리, 구역별)
  const organizePieces = () => {
    const targetPieces = pieces.map(p => ({
        ...p,
        currentPos: { ...p.currentPos },
    }));

    {
        const currentPieces = targetPieces;
        const groupSize = new Map<number, number>();
        currentPieces.forEach((piece) => {
            groupSize.set(piece.group, (groupSize.get(piece.group) || 0) + 1);
        });
        const sortablePieces = currentPieces.filter(
            (piece) => !piece.isSolved && (groupSize.get(piece.group) || 0) <= 1
        );
        if (sortablePieces.length === 0) return;

        const isBorderPiece = (p: PuzzlePiece) => {
            if (p.edges && p.edges.length > 0) {
                return p.edges.some((edge) => edge.neighborId == null);
            }
            return p.shape.top === 0 || p.shape.bottom === 0 || p.shape.left === 0 || p.shape.right === 0;
        };

        const maxPieceW = Math.max(1, ...sortablePieces.map(p => getPieceFootprint(p).width));
        const maxPieceH = Math.max(1, ...sortablePieces.map(p => getPieceFootprint(p).height));
        // Use sprite footprint (including tab padding) to prevent overlap after sort.
        const extraGapPx = 1;
        const gapX = (maxPieceW + extraGapPx) * 1.2;
        const gapY = (maxPieceH + extraGapPx) * 1.2;

        // 정렬된 조각들을 프레임 바깥(우측)에 배치
        const sideMargin = Math.max(maxPieceW * 0.8, boardWidth * 0.08);
        const startX = boardWidth + sideMargin;
        const startY = boardHeight * 0.12;

        const layoutLinear = (
            list: PuzzlePiece[],
            originX: number,
            originY: number,
            cols: number
        ) => {
            const safeCols = Math.max(1, cols);
            list.forEach((p, idx) => {
                const r = Math.floor(idx / safeCols);
                const c = idx % safeCols;
                p.currentPos.x = originX + c * gapX;
                p.currentPos.y = originY + r * gapY;
            });
        };

        const estimateCurrentCols = (list: PuzzlePiece[]) => {
            const baseCols = Math.max(1, Math.ceil(Math.sqrt(list.length * 2)));
            const xs = list
                .map(p => p.currentPos.x)
                .sort((a, b) => a - b);
            if (xs.length === 0) return baseCols;

            let cols = 0;
            let lastX = Number.NEGATIVE_INFINITY;
            const threshold = gapX * 0.45;
            for (const x of xs) {
                if (Math.abs(x - lastX) > threshold) {
                    cols += 1;
                    lastX = x;
                }
            }

            if (cols <= 0 || cols > baseCols * 2) return baseCols;
            return Math.min(cols, list.length);
        };

        const visualOrder = [...sortablePieces].sort((a, b) => {
            const dy = a.currentPos.y - b.currentPos.y;
            if (Math.abs(dy) > maxPieceH * 0.5) return dy;
            return a.currentPos.x - b.currentPos.x;
        });

        if (sortOptions.border) {
            // 기존 정렬 순서를 유지한 채 border/non-border만 안정적으로 분리
            const borderPieces = visualOrder.filter(isBorderPiece);
            const innerPieces = visualOrder.filter(p => !isBorderPiece(p));
            const cols = estimateCurrentCols(visualOrder);

            // border 정렬 시 가로 길이를 기존 정렬 폭과 동일하게 유지하고,
            // border와 inner를 두 개의 블록으로 명확히 분리한다.
            layoutLinear(borderPieces, startX, startY, cols);
            const borderRows = Math.ceil(borderPieces.length / Math.max(1, cols));
            const sectionGapY = gapY * 1.1;
            const innerStartY = startY + borderRows * gapY + sectionGapY;
            layoutLinear(innerPieces, startX, innerStartY, cols);
        } else if (sortOptions.color) {
            const getPieceHsl = (piece: PuzzlePiece): [number, number, number] => piece.hsl ?? [0, 0, 0.5];
            const getQuantile = (sorted: number[], q: number) => {
                if (sorted.length === 0) return 0;
                const idx = Math.min(
                    sorted.length - 1,
                    Math.max(0, Math.floor((sorted.length - 1) * q))
                );
                return sorted[idx];
            };

            const lightnessValues = sortablePieces
                .map((piece) => getPieceHsl(piece)[2])
                .sort((a, b) => a - b);
            const saturationValues = sortablePieces
                .map((piece) => getPieceHsl(piece)[1])
                .sort((a, b) => a - b);

            let darkThreshold = getQuantile(lightnessValues, 0.33);
            let brightThreshold = getQuantile(lightnessValues, 0.66);
            if (brightThreshold - darkThreshold < 0.1) {
                darkThreshold = 0.38;
                brightThreshold = 0.62;
            }

            const lowSaturationThreshold = Math.min(
                0.28,
                Math.max(0.1, getQuantile(saturationValues, 0.25))
            );

            const dark: PuzzlePiece[] = [];
            const mid: PuzzlePiece[] = [];
            const bright: PuzzlePiece[] = [];

            sortablePieces.forEach((piece) => {
                const [, , lightness] = getPieceHsl(piece);
                if (lightness < darkThreshold) dark.push(piece);
                else if (lightness > brightThreshold) bright.push(piece);
                else mid.push(piece);
            });

            const arrangeBand = (band: PuzzlePiece[]) => {
                const colorful: PuzzlePiece[] = [];
                const neutral: PuzzlePiece[] = [];
                band.forEach((piece) => {
                    const [, saturation] = getPieceHsl(piece);
                    if (saturation < lowSaturationThreshold) neutral.push(piece);
                    else colorful.push(piece);
                });

                colorful.sort((a, b) => {
                    const [hA, sA, lA] = getPieceHsl(a);
                    const [hB, sB, lB] = getPieceHsl(b);

                    const hueBucketA = Math.floor(hA * 36);
                    const hueBucketB = Math.floor(hB * 36);
                    if (hueBucketA !== hueBucketB) return hueBucketA - hueBucketB;
                    if (Math.abs(hA - hB) > 0.01) return hA - hB;
                    if (Math.abs(sA - sB) > 0.03) return sB - sA;
                    return lA - lB;
                });

                neutral.sort((a, b) => {
                    const [, sA, lA] = getPieceHsl(a);
                    const [, sB, lB] = getPieceHsl(b);
                    if (Math.abs(lA - lB) > 0.01) return lA - lB;
                    return sA - sB;
                });

                return [...colorful, ...neutral];
            };

            const darkSorted = arrangeBand(dark);
            const midSorted = arrangeBand(mid);
            const brightSorted = arrangeBand(bright);
            const cols = Math.max(1, Math.ceil(Math.sqrt(sortablePieces.length * 2)));
            const sectionGapY = gapY * 0.9;

            layoutLinear(darkSorted, startX, startY, cols);
            const darkRows = Math.ceil(darkSorted.length / cols);
            const midStartY = startY + darkRows * gapY + sectionGapY;
            layoutLinear(midSorted, startX, midStartY, cols);
            const midRows = Math.ceil(midSorted.length / cols);
            const brightStartY = midStartY + midRows * gapY + sectionGapY;
            layoutLinear(brightSorted, startX, brightStartY, cols);
        } else if (sortOptions.region) {
            // region 선택 시 3x3 구역별로 블록을 분리 배치해 구분감을 준다.
            // 퍼즐 개수가 많을수록 구역 간 간격을 넓혀 시인성을 유지한다.
            const pieceScale = Math.max(0.8, Math.sqrt(sortablePieces.length / 80));
            const regionGapMultiplier = 2.0 + pieceScale * 1.2;
            const blockSpanMultiplier = 2.1 + pieceScale * 1.2;
            const regionGapX = gapX * regionGapMultiplier;
            const regionGapY = gapY * regionGapMultiplier;
            const regionCols = 3;
            const regionRows = 3;

            for (let rr = 0; rr < regionRows; rr++) {
                for (let rc = 0; rc < regionCols; rc++) {
                    const regionIdx = rr * regionCols + rc;
                    const regionList = visualOrder.filter(p => p.regionIndex === regionIdx);
                    if (regionList.length === 0) continue;

                    const localCols = Math.max(1, Math.ceil(Math.sqrt(regionList.length)));
                    const originX = startX + rc * (maxPieceW * blockSpanMultiplier + regionGapX);
                    const originY = startY + rr * (maxPieceH * blockSpanMultiplier + regionGapY);
                    layoutLinear(regionList, originX, originY, localCols);
                }
            }
        }
    }

    const startPosById = new Map<number, Point>(
        pieces.map(p => [p.id, { x: p.currentPos.x, y: p.currentPos.y }])
    );
    const targetPosById = new Map<number, Point>(
        targetPieces.map(p => [p.id, { x: p.currentPos.x, y: p.currentPos.y }])
    );

    if (targetPieces.length > 0) {
        setFitViewRequest(buildFitRequest(targetPieces));
    }

    if (sortAnimationFrame.current !== null) {
        cancelAnimationFrame(sortAnimationFrame.current);
        sortAnimationFrame.current = null;
    }

    const durationMs = 380;
    const startAt = performance.now();
    setIsSortAnimating(true);

    const tick = (now: number) => {
        const t = Math.min(1, (now - startAt) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);

        setPieces(prev =>
            prev.map(piece => {
                if (piece.isSolved) return piece;
                const from = startPosById.get(piece.id);
                const to = targetPosById.get(piece.id);
                if (!from || !to) return piece;

                return {
                    ...piece,
                    currentPos: {
                        x: from.x + (to.x - from.x) * eased,
                        y: from.y + (to.y - from.y) * eased,
                    },
                };
            })
        );

        if (t < 1) {
            sortAnimationFrame.current = requestAnimationFrame(tick);
            return;
        }

        sortAnimationFrame.current = null;
        setIsSortAnimating(false);
        setPieces(targetPieces);
    };

    sortAnimationFrame.current = requestAnimationFrame(tick);
    
    setShowSortMenu(false);
  };

  const completionTheme = useMemo(() => {
    if (!settings.irregularMode) {
      return { accent: '#F2D086', glow: 'rgba(242,208,134,0.24)', label: 'CLASSIC EDITION' };
    }
    return { accent: '#7CC7FF', glow: 'rgba(124,199,255,0.26)', label: 'IRREGULAR EDITION' };
  }, [settings.irregularMode]);
  const downloadCompletedImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = boardWidth;
    canvas.height = boardHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // NOTE:
    // - cachedSprite is generated with flipY for Three.js.
    // - cachedSprite is also rendered at spriteScale (devicePixelRatio).
    // - export must compensate both to avoid cropped / shifted tiles.
    const drawablePieces = pieces
      .filter((p) => p.cachedSprite)
      .sort((a, b) => a.correctRow - b.correctRow || a.correctCol - b.correctCol);

    if (drawablePieces.length === 0) {
      ctx.drawImage(boardImage, 0, 0, boardWidth, boardHeight);
    } else {
      drawablePieces.forEach((piece) => {
        const sprite = piece.cachedSprite as CanvasImageSource;
        const spriteBitmap = piece.cachedSprite as ImageBitmap | HTMLCanvasElement;
        const spriteScale = piece.spriteScale || 1;
        const spritePixelW = spriteBitmap.width;
        const spritePixelH = spriteBitmap.height;
        const spriteW = spritePixelW / spriteScale;
        const spriteH = spritePixelH / spriteScale;
        const drawX = piece.targetPos.x + (piece.spriteOffset?.x || 0);
        const drawY = piece.targetPos.y + (piece.spriteOffset?.y || 0);
        ctx.save();
        ctx.scale(1, -1);
        ctx.drawImage(
          sprite,
          0,
          0,
          spritePixelW,
          spritePixelH,
          drawX,
          -(drawY + spriteH),
          spriteW,
          spriteH
        );
        ctx.restore();
      });
    }

    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `puzzle-complete-${settings.pieceCount}-${stamp}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-[#1a1a1a] overflow-hidden select-none">
        <div className="absolute inset-0 z-0">
            <Canvas
                shadows={!heavyPieceMode}
                camera={{ 
                    position: [boxFocusX, boxFocusY, cameraZ], 
                    fov: cameraFovDeg, 
                    up: [0,1,0],
                    near: 0.1,
                    far: farPlane 
                }}
                dpr={heavyPieceMode ? [1, 1] : [1, 2]}
                gl={{
                    preserveDrawingBuffer: false,
                    antialias: true,
                    alpha: false,
                    powerPreference: 'high-performance',
                }}
            >
                <Suspense fallback={null}>
                    <>
                        <CameraReset
                            targetX={boxFocusX}
                            targetY={boxFocusY}
                            targetZ={0}
                            z={cameraZ}
                            controlsRef={controlsRef}
                        />
                        <CameraFitController
                            fitRequest={fitViewRequest}
                            controlsRef={controlsRef}
                            durationMs={CAMERA_FIT_DURATION_MS}
                            stopToken={cameraFitStopToken}
                        />
                        <GameScene 
                            pieces={pieces} 
                            setPieces={setPieces} 
                            settings={settings} 
                            setSolvedCount={setSolvedCount}
                            setDragState={setIsDragging}
                            boardSize={{ width: boardWidth, height: boardHeight }}
                            image={boardImage}
                            onPieceConnect={handlePieceConnect}
                            onBoxClick={handleReferenceToggle}
                            onBoxPointerDown={() => setIsBoxInteracting(true)}
                            onBoxPointerUp={() => setIsBoxInteracting(false)}
                            floorTheme={floorTheme}
                            neighborMap={neighborMap}
                            onDragStart={() => setCameraFitStopToken(prev => prev + 1)}
                            introActive={showIntroCinematic}
                            introPhase={introPhase}
                        />
                        <MapControls 
                            ref={controlsRef}
                            enabled={!isLoading && !isInitialCameraMoveRunning && !isDragging && !isBoxInteracting && !showIntroCinematic} 
                            enableRotate={false} 
                            minPolarAngle={Math.PI / 2}
                            maxPolarAngle={Math.PI / 2}
                            minAzimuthAngle={0}
                            maxAzimuthAngle={0}
                            screenSpacePanning={true}
                            dampingFactor={0.1}
                            minDistance={minZoomDistance}
                            maxDistance={maxZoomDistance}
                        />
                    </>
                </Suspense>
            </Canvas>
        </div>

        <div className="absolute top-0 left-0 right-0 h-14 bg-[#1a110d]/90 flex items-center justify-between px-4 z-20 border-b border-[#5c3a2a] backdrop-blur-md pointer-events-auto">
            <div className="flex items-center gap-4">
                <Button variant="secondary" onClick={onExit} className="flex items-center gap-2">
                    <ArrowLeft size={16} /> Exit
                </Button>
                <div className="text-[#F2D086] font-bold">
                    {Math.floor((solvedCount / Math.max(1, pieces.length)) * 100)}% Complete
                </div>
            </div>
            
            <div className="text-[#8B4513] font-cinzel text-lg hidden md:block">
               {isCompleted ? "Puzzle Completed" : "Assemble the Puzzle"}
            </div>

            <div className="flex items-center gap-2">
                <div className="px-3 h-9 rounded border border-[#5c3a2a] bg-[#1a110d] text-[#F2D086] flex items-center gap-2 text-sm">
                    <Clock3 size={14} />
                    <span className="tabular-nums">{formatDuration(elapsedSeconds)}</span>
                </div>
                <div className="relative">
                    <Button 
                        variant={showSortMenu ? "primary" : "secondary"}
                        onClick={() => {
                            setShowSortMenu(!showSortMenu);
                            setShowSettingsMenu(false);
                        }}
                        title="Sort Pieces"
                        className="flex items-center gap-2 px-3"
                    >
                        <SlidersHorizontal size={18} />
                        <span className="hidden sm:inline">Sort</span>
                    </Button>
                    
                    {showSortMenu && (
                        <div className="absolute top-full right-0 mt-2 w-56 bg-[#1a110d] border border-[#8B4513] rounded shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 z-50">
                            <h4 className="text-[#F2D086] font-cinzel text-sm border-b border-[#5c3a2a] pb-2 mb-1">Sorting Criteria</h4>
                            
                            <label className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-1 rounded">
                                <span className="text-[#d4b491] text-sm">Color</span>
                                <div 
                                    className={`w-5 h-5 border rounded flex items-center justify-center ${sortOptions.color ? 'bg-[#8B4513] border-[#F2D086]' : 'border-[#5c3a2a]'}`}
                                    onClick={() => selectSortOption('color')}
                                >
                                    {sortOptions.color && <Check size={14} className="text-[#F2D086]" />}
                                </div>
                            </label>

                            <label className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-1 rounded">
                                <span className="text-[#d4b491] text-sm">Border Pieces</span>
                                <div 
                                    className={`w-5 h-5 border rounded flex items-center justify-center ${sortOptions.border ? 'bg-[#8B4513] border-[#F2D086]' : 'border-[#5c3a2a]'}`}
                                    onClick={() => selectSortOption('border')}
                                >
                                    {sortOptions.border && <Check size={14} className="text-[#F2D086]" />}
                                </div>
                            </label>

                            <label className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-1 rounded">
                                <span className="text-[#d4b491] text-sm">Region (3x3)</span>
                                <div 
                                    className={`w-5 h-5 border rounded flex items-center justify-center ${sortOptions.region ? 'bg-[#8B4513] border-[#F2D086]' : 'border-[#5c3a2a]'}`}
                                    onClick={() => selectSortOption('region')}
                                >
                                    {sortOptions.region && <Check size={14} className="text-[#F2D086]" />}
                                </div>
                            </label>

                            <Button onClick={organizePieces} disabled={isSortAnimating} className="w-full mt-2 text-sm py-2">
                                Apply Sort
                            </Button>
                        </div>
                    )}
                </div>
                <div className="relative">
                    <Button
                        variant={showSettingsMenu ? "primary" : "secondary"}
                        onClick={() => {
                            setShowSettingsMenu(!showSettingsMenu);
                            setShowSortMenu(false);
                        }}
                        title="Settings"
                        className="flex items-center gap-2 px-3"
                    >
                        <Settings2 size={18} />
                        <span className="hidden sm:inline">Settings</span>
                    </Button>

                    {showSettingsMenu && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-[#1a110d] border border-[#8B4513] rounded shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 z-50">
                            <h4 className="text-[#F2D086] font-cinzel text-sm border-b border-[#5c3a2a] pb-2 mb-1">Settings</h4>
                            <div className="flex flex-col gap-2">
                                <span className="text-[#d4b491] text-sm">Floor Theme</span>
                                <div className="grid grid-cols-1 gap-2">
                                    {([
                                        { key: 'birch', label: 'Birch (Recommended)' },
                                        { key: 'soft', label: 'Soft Wood' },
                                        { key: 'walnut', label: 'Walnut' },
                                    ] as const).map(option => (
                                        <button
                                            key={option.key}
                                            onClick={() => setFloorTheme(option.key)}
                                            className={`text-left px-2 py-1 rounded border text-sm ${floorTheme === option.key ? 'bg-[#8B4513] border-[#F2D086] text-[#F2D086]' : 'border-[#5c3a2a] text-[#d4b491] hover:bg-white/5'}`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <p className="text-xs text-[#8B4513] pt-1 border-t border-[#5c3a2a]">
                                More controls (SFX/BGM/animation) will be added here.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
        
        {notification && (
            <div className="absolute bottom-20 right-6 z-50 pointer-events-none">
                <div className="bg-[#1a110d]/95 text-[#F2D086] px-6 py-3 rounded border border-[#8B4513] shadow-[0_0_15px_rgba(242,208,134,0.2)] flex items-center gap-2 animate-in slide-in-from-bottom-5 fade-in duration-300">
                    <Check size={18} />
                    <span className="font-cinzel font-bold">{notification}</span>
                </div>
            </div>
        )}

        {showBox && (
            <div className="absolute bottom-4 right-4 z-30 w-64 md:w-80 bg-[#1a110d] p-2 rounded border border-[#8B4513] shadow-2xl animate-in fade-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-1 px-1">
                    <span className="text-[#8B4513] text-xs font-bold uppercase">Reference</span>
                    <button onClick={() => setShowBox(false)} className="text-[#8B4513] hover:text-[#F2D086]"><EyeOff size={14}/></button>
                </div>
                <img src={image.src} className="w-full h-auto rounded border border-[#5c3a2a]" />
            </div>
        )}

        {showIntroCinematic && !isLoading && (
            <div className="absolute top-16 right-4 z-40">
                <button
                    onClick={finishIntro}
                    className="px-3 py-1 text-xs rounded border border-[#8B4513] text-[#d4b491] bg-[#1a110d]/90 hover:bg-[#3e2723]"
                >
                    Skip Intro
                </button>
            </div>
        )}

        {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#1a110d]/68 backdrop-blur-[2px] text-[#F2D086]">
                <Loader2 size={48} className="animate-spin mb-4" />
                <h2 className="text-2xl font-cinzel">Preparing your puzzle...</h2>
                <p className="text-[#d4b491] mt-2">Generating {settings.pieceCount} pieces</p>
                {totalPieceCount > 0 && (
                    <p className="text-[#8B4513] mt-1 tabular-nums">
                        Textures {spriteReadyCount}/{totalPieceCount}
                    </p>
                )}
            </div>
        )}

        {loadingTimedOut && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 rounded border border-amber-400/60 bg-[#1a110d]/92 px-4 py-2 text-sm text-amber-200">
                Large puzzle setup is still in progress. Please wait a moment.
            </div>
        )}

        {!isLoading && isSpriteStreaming && (
            <div className="absolute bottom-4 left-4 z-30 rounded border border-[#5c3a2a] bg-[#1a110d]/90 px-3 py-2 text-xs text-[#d4b491]">
                <div className="flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="tabular-nums">Loading piece textures {spriteReadyCount}/{totalPieceCount}</span>
                </div>
            </div>
        )}

        {!isLoading && isCompleted && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-40 pointer-events-auto">
                <div
                    className="bg-[#1a110d] p-8 rounded-lg border-2 text-center shadow-2xl animate-bounce-in"
                    style={{
                        borderColor: completionTheme.accent,
                        boxShadow: `0 16px 42px ${completionTheme.glow}`,
                    }}
                >
                    <h2 className="text-4xl font-bold mb-2 font-cinzel" style={{ color: completionTheme.accent }}>
                        Puzzle Complete!
                    </h2>
                    <p className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: completionTheme.accent }}>
                        {completionTheme.label}
                    </p>
                    <div className="mx-auto mb-4 w-52 rounded-md overflow-hidden border" style={{ borderColor: completionTheme.accent }}>
                        <img src={image.src} alt="Completed art" className="w-full h-auto block" />
                    </div>
                    <p className="text-[#d4b491] mb-6">Great work. The puzzle is fully assembled.</p>
                    <div className="text-[#F2D086] mb-6 space-y-1">
                        <p>Time: <span className="font-bold tabular-nums">{formatDuration(finalTimeSec ?? elapsedSeconds)}</span></p>
                        {bestTimeSec !== null && (
                            <p className="text-[#d4b491] text-sm">Best: <span className="tabular-nums">{formatDuration(bestTimeSec)}</span></p>
                        )}
                        {lastTimeSec !== null && (
                            <p className="text-[#8B4513] text-xs">Saved: {formatDuration(lastTimeSec)}</p>
                        )}
                    </div>
                    <Button variant="primary" onClick={downloadCompletedImage} className="w-full mb-3 flex items-center justify-center gap-2">
                        <Download size={16} />
                        Download PNG
                    </Button>
                    <Button variant="secondary" onClick={onExit} className="w-full">Return to Menu</Button>
                </div>
            </div>
        )}
    </div>
  );
};
