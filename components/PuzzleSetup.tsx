import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FrameRect,
  FrameSelectionState,
  FrameShape,
  GameSettings,
  StartGamePayload,
} from '../types';
import { Button } from './Button';
import { Upload, Settings, Image as ImageIcon } from 'lucide-react';

interface PuzzleSetupProps {
  onStart: (payload: StartGamePayload) => void;
  initialImage?: HTMLImageElement | null;
  initialSettings?: GameSettings | null;
  initialFrame?: FrameSelectionState | null;
}

const DEFAULT_SETTINGS: GameSettings = {
  pieceCount: 300,
  rotationEnabled: false,
  showGhost: true,
  snapDistance: 30,
  irregularMode: false,
};

const ALLOWED_PIECE_COUNTS = [50, 100, 300, 500, 1000] as const;
const FRAME_MIN_SIZE = 0.2;

const DEFAULT_FRAME_RECT: FrameRect = {
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const FRAME_SHAPES: Array<{ key: FrameShape; label: string }> = [
  { key: 'rect', label: 'Rectangle' },
  { key: 'circle', label: 'Circle' },
  { key: 'diamond', label: 'Diamond' },
  { key: 'heart', label: 'Heart' },
];

const NON_RECT_SHAPE_ANCHORS: Record<
  Exclude<FrameShape, 'rect'>,
  Record<'n' | 'e' | 's' | 'w', [number, number]>
> = {
  circle: {
    n: [0.5, 0],
    e: [1, 0.5],
    s: [0.5, 1],
    w: [0, 0.5],
  },
  diamond: {
    n: [0.5, 0],
    e: [1, 0.5],
    s: [0.5, 1],
    w: [0, 0.5],
  },
  // Heart contour anchors (normalized in the bounding box).
  heart: {
    n: [0.5, 0.2],
    e: [0.98, 0.44],
    s: [0.5, 0.95],
    w: [0.02, 0.44],
  },
};

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';

type FrameMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalizePieceCount = (count: number) => {
  if (ALLOWED_PIECE_COUNTS.includes(count as (typeof ALLOWED_PIECE_COUNTS)[number])) return count;
  if (count >= 1000) return 1000;
  if (count >= 500) return 500;
  if (count >= 300) return 300;
  if (count >= 100) return 100;
  return 50;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampFrameRect = (next: FrameRect): FrameRect => {
  const w = clamp(next.w, FRAME_MIN_SIZE, 1);
  const h = clamp(next.h, FRAME_MIN_SIZE, 1);
  const x = clamp(next.x, 0, 1 - w);
  const y = clamp(next.y, 0, 1 - h);
  return { x, y, w, h };
};

const getSafeAspect = (aspect: number) => Math.max(0.0001, aspect);

const getUniformHalfWidthBounds = (cx: number, cy: number, aspect: number) => {
  const safeAspect = getSafeAspect(aspect);
  // Keep minimum based on the shorter axis in pixel space.
  const minHalfW = FRAME_MIN_SIZE / (2 * Math.max(1, safeAspect));
  const maxByX = Math.min(cx, 1 - cx);
  const maxByY = Math.min(cy / safeAspect, (1 - cy) / safeAspect);
  const maxHalfW = Math.max(minHalfW, Math.min(maxByX, maxByY));
  return { minHalfW, maxHalfW };
};

const createUniformShapeRect = (
  cx: number,
  cy: number,
  halfW: number,
  aspect: number
): FrameRect => {
  const safeAspect = getSafeAspect(aspect);
  const { minHalfW, maxHalfW } = getUniformHalfWidthBounds(cx, cy, safeAspect);
  const clampedHalfW = clamp(halfW, minHalfW, maxHalfW);
  const halfH = clampedHalfW * safeAspect;
  return {
    x: cx - clampedHalfW,
    y: cy - halfH,
    w: clampedHalfW * 2,
    h: halfH * 2,
  };
};

const normalizeFrameForShape = (rect: FrameRect, shape: FrameShape, aspect = 1): FrameRect => {
  const base = clampFrameRect(rect);
  if (shape === 'rect') return base;
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  const safeAspect = getSafeAspect(aspect);
  const halfWFromWidth = base.w / 2;
  const halfWFromHeight = base.h / (2 * safeAspect);
  return createUniformShapeRect(cx, cy, Math.max(halfWFromWidth, halfWFromHeight), safeAspect);
};

const getShapeClipPath = (shape: FrameShape) => {
  if (shape === 'circle') return 'circle(50% at 50% 50%)';
  if (shape === 'diamond') return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
  if (shape === 'heart') {
    return 'polygon(50% 95%, 34% 86%, 18% 74%, 8% 59%, 2% 45%, 2% 33%, 8% 17%, 22% 8%, 39% 10%, 50% 20%, 61% 10%, 78% 8%, 92% 17%, 98% 33%, 98% 45%, 92% 59%, 82% 74%, 66% 86%)';
  }
  return 'inset(0)';
};

const getShapePathD = (shape: FrameShape, x: number, y: number, w: number, h: number): string => {
  if (shape === 'rect') {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }

  if (shape === 'circle') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2;
    return [
      `M ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
      'Z',
    ].join(' ');
  }

  if (shape === 'diamond') {
    return [
      `M ${x + w / 2} ${y}`,
      `L ${x + w} ${y + h / 2}`,
      `L ${x + w / 2} ${y + h}`,
      `L ${x} ${y + h / 2}`,
      'Z',
    ].join(' ');
  }

  return [
    `M ${x + w * 0.5} ${y + h * 0.95}`,
    `C ${x + w * 0.17} ${y + h * 0.77} ${x + w * 0.02} ${y + h * 0.52} ${x + w * 0.02} ${y + h * 0.33}`,
    `C ${x + w * 0.02} ${y + h * 0.17} ${x + w * 0.15} ${y + h * 0.08} ${x + w * 0.29} ${y + h * 0.08}`,
    `C ${x + w * 0.39} ${y + h * 0.08} ${x + w * 0.47} ${y + h * 0.14} ${x + w * 0.5} ${y + h * 0.2}`,
    `C ${x + w * 0.53} ${y + h * 0.14} ${x + w * 0.61} ${y + h * 0.08} ${x + w * 0.71} ${y + h * 0.08}`,
    `C ${x + w * 0.85} ${y + h * 0.08} ${x + w * 0.98} ${y + h * 0.17} ${x + w * 0.98} ${y + h * 0.33}`,
    `C ${x + w * 0.98} ${y + h * 0.52} ${x + w * 0.83} ${y + h * 0.77} ${x + w * 0.5} ${y + h * 0.95}`,
    'Z',
  ].join(' ');
};

const drawShapeMask = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  shape: FrameShape
) => {
  const pathD = getShapePathD(shape, x, y, width, height);
  if (typeof Path2D !== 'undefined') {
    ctx.fill(new Path2D(pathD));
    return;
  }

  ctx.beginPath();
  if (shape === 'circle') {
    const r = Math.min(width, height) / 2;
    ctx.arc(x + width / 2, y + height / 2, r, 0, Math.PI * 2);
  } else if (shape === 'diamond') {
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height / 2);
    ctx.lineTo(x + width / 2, y + height);
    ctx.lineTo(x, y + height / 2);
    ctx.closePath();
  } else if (shape === 'heart') {
    ctx.moveTo(x + width * 0.5, y + height * 0.95);
    ctx.bezierCurveTo(x + width * 0.17, y + height * 0.77, x + width * 0.02, y + height * 0.52, x + width * 0.02, y + height * 0.33);
    ctx.bezierCurveTo(x + width * 0.02, y + height * 0.17, x + width * 0.15, y + height * 0.08, x + width * 0.29, y + height * 0.08);
    ctx.bezierCurveTo(x + width * 0.39, y + height * 0.08, x + width * 0.47, y + height * 0.14, x + width * 0.5, y + height * 0.2);
    ctx.bezierCurveTo(x + width * 0.53, y + height * 0.14, x + width * 0.61, y + height * 0.08, x + width * 0.71, y + height * 0.08);
    ctx.bezierCurveTo(x + width * 0.85, y + height * 0.08, x + width * 0.98, y + height * 0.17, x + width * 0.98, y + height * 0.33);
    ctx.bezierCurveTo(x + width * 0.98, y + height * 0.52, x + width * 0.83, y + height * 0.77, x + width * 0.5, y + height * 0.95);
    ctx.closePath();
  } else {
    ctx.rect(x, y, width, height);
  }
  ctx.fill();
};

const getDifficultyLabel = (count: number) => {
  switch (count) {
    case 50:
      return 'Quick';
    case 100:
      return 'Beginner';
    case 300:
      return 'Standard';
    case 500:
      return 'Advanced';
    case 1000:
      return 'Expert';
    default:
      return 'Custom';
  }
};

export const PuzzleSetup: React.FC<PuzzleSetupProps> = ({
  onStart,
  initialImage = null,
  initialSettings = null,
  initialFrame = null,
}) => {
  const UPSCALE_MIN_SHORT_SIDE = 1200;

  const getQualityThresholds = (pieceCount: number) => {
    if (pieceCount >= 500) {
      return { blockShortSide: 640, blockPixels: 500_000, warnShortSide: 900, warnPixels: 1_200_000 };
    }
    return { blockShortSide: 480, blockPixels: 250_000, warnShortSide: 700, warnPixels: 450_000 };
  };

  const initialShape = initialFrame?.shape ?? 'rect';
  const initialAspect = initialImage ? initialImage.width / Math.max(1, initialImage.height) : 1;
  const initialRect = normalizeFrameForShape(initialFrame?.rect ?? DEFAULT_FRAME_RECT, initialShape, initialAspect);

  const [selectedImage, setSelectedImage] = useState<string | null>(initialImage?.src ?? null);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(initialImage);
  const [imageNotice, setImageNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 0, height: 0 });
  const [frameRect, setFrameRect] = useState<FrameRect>(initialRect);
  const [frameShape, setFrameShape] = useState<FrameShape>(initialShape);
  const [isPreparingStart, setIsPreparingStart] = useState(false);

  const frameInteractionRef = useRef<{
    mode: 'move' | 'resize';
    handle?: ResizeHandle;
    startClientX: number;
    startClientY: number;
    startRect: FrameRect;
    startShape: FrameShape;
  } | null>(null);

  const [settings, setSettings] = useState<GameSettings>(() => {
    const seed = initialSettings ?? DEFAULT_SETTINGS;
    return {
      ...seed,
      pieceCount: normalizePieceCount(seed.pieceCount),
    };
  });

  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el) return;

    const update = () => {
      setPreviewAreaSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => update());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const frameMetrics = useMemo<FrameMetrics | null>(() => {
    if (!imgElement) return null;
    const cw = previewAreaSize.width;
    const ch = previewAreaSize.height;
    if (cw <= 0 || ch <= 0) return null;

    const imgAspect = Math.max(0.01, imgElement.width / Math.max(1, imgElement.height));
    const boxAspect = cw / Math.max(1, ch);

    if (imgAspect >= boxAspect) {
      const width = cw;
      const height = width / imgAspect;
      return { x: 0, y: (ch - height) / 2, width, height };
    }

    const height = ch;
    const width = height * imgAspect;
    return { x: (cw - width) / 2, y: 0, width, height };
  }, [imgElement, previewAreaSize]);

  const framePixels = useMemo(() => {
    if (!frameMetrics) return null;
    const x = frameMetrics.x + frameRect.x * frameMetrics.width;
    const y = frameMetrics.y + frameRect.y * frameMetrics.height;
    const w = frameRect.w * frameMetrics.width;
    const h = frameRect.h * frameMetrics.height;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return { x, y, w, h, cx, cy };
  }, [frameMetrics, frameRect]);

  const activeImageAspect = useMemo(() => {
    if (frameMetrics) return frameMetrics.width / Math.max(1, frameMetrics.height);
    if (imgElement) return imgElement.width / Math.max(1, imgElement.height);
    return 1;
  }, [frameMetrics, imgElement]);

  const overlayPaths = useMemo(() => {
    if (!framePixels || previewAreaSize.width <= 0 || previewAreaSize.height <= 0) return null;

    const outer = `M 0 0 H ${previewAreaSize.width} V ${previewAreaSize.height} H 0 Z`;
    const inner = getShapePathD(frameShape, framePixels.x, framePixels.y, framePixels.w, framePixels.h);
    return {
      inner,
      dim: `${outer} ${inner}`,
    };
  }, [framePixels, frameShape, previewAreaSize]);

  const runSharpenPass = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const src = ctx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    const s = src.data;
    const d = dst.data;
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const out = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          let k = 0;
          for (let ky = -1; ky <= 1; ky++) {
            const py = Math.min(h - 1, Math.max(0, y + ky));
            for (let kx = -1; kx <= 1; kx++) {
              const px = Math.min(w - 1, Math.max(0, x + kx));
              const idx = (py * w + px) * 4 + c;
              acc += s[idx] * kernel[k++];
            }
          }
          d[out + c] = Math.min(255, Math.max(0, Math.round(acc)));
        }
        d[out + 3] = s[out + 3];
      }
    }

    ctx.putImageData(dst, 0, 0);
  };

  const buildFrameLockedImage = (
    src: HTMLImageElement,
    rect: FrameRect,
    shape: FrameShape,
    emphasizeOutside = false
  ): Promise<HTMLImageElement> => {
    const sourceW = Math.max(1, src.naturalWidth || src.width);
    const sourceH = Math.max(1, src.naturalHeight || src.height);
    const nx = clamp(rect.x, 0, 1);
    const ny = clamp(rect.y, 0, 1);
    const nw = clamp(rect.w, 0.05, 1);
    const nh = clamp(rect.h, 0.05, 1);

    const sx = Math.round(nx * sourceW);
    const sy = Math.round(ny * sourceH);
    const sw = Math.max(1, Math.round(nw * sourceW));
    const sh = Math.max(1, Math.round(nh * sourceH));
    const clippedW = Math.min(sw, sourceW - sx);
    const clippedH = Math.min(sh, sourceH - sy);

    const sharpCanvas = document.createElement('canvas');
    sharpCanvas.width = clippedW;
    sharpCanvas.height = clippedH;
    const sharpCtx = sharpCanvas.getContext('2d');
    if (!sharpCtx) return Promise.resolve(src);
    sharpCtx.imageSmoothingEnabled = true;
    sharpCtx.imageSmoothingQuality = 'high';
    sharpCtx.drawImage(src, sx, sy, clippedW, clippedH, 0, 0, clippedW, clippedH);

    const canvas = document.createElement('canvas');
    canvas.width = clippedW;
    canvas.height = clippedH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(src);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (shape === 'rect' || !emphasizeOutside) {
      ctx.drawImage(sharpCanvas, 0, 0);
    } else {
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = sourceW;
      blurCanvas.height = sourceH;
      const blurCtx = blurCanvas.getContext('2d');
      if (!blurCtx) return Promise.resolve(src);
      blurCtx.imageSmoothingEnabled = true;
      blurCtx.imageSmoothingQuality = 'high';
      blurCtx.filter = 'blur(6px)';
      blurCtx.drawImage(src, 0, 0, sourceW, sourceH);
      blurCtx.filter = 'none';
      blurCtx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      blurCtx.fillRect(0, 0, sourceW, sourceH);

      canvas.width = sourceW;
      canvas.height = sourceH;
      ctx.drawImage(blurCanvas, 0, 0);
      const maskedSharpCanvas = document.createElement('canvas');
      maskedSharpCanvas.width = sourceW;
      maskedSharpCanvas.height = sourceH;
      const maskedSharpCtx = maskedSharpCanvas.getContext('2d');
      if (!maskedSharpCtx) return Promise.resolve(src);
      maskedSharpCtx.drawImage(src, 0, 0, sourceW, sourceH);
      maskedSharpCtx.globalCompositeOperation = 'destination-in';
      maskedSharpCtx.fillStyle = '#ffffff';
      drawShapeMask(maskedSharpCtx, sx, sy, clippedW, clippedH, shape);
      maskedSharpCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(maskedSharpCanvas, 0, 0);
    }

    return new Promise((resolve) => {
      const cropped = new Image();
      cropped.onload = () => resolve(cropped);
      cropped.src = canvas.toDataURL('image/png');
    });
  };

  const buildPuzzleReadyImage = (src: HTMLImageElement): Promise<HTMLImageElement> => {
    const sourceW = Math.max(1, src.naturalWidth || src.width);
    const sourceH = Math.max(1, src.naturalHeight || src.height);
    const shortSide = Math.min(sourceW, sourceH);
    const upscale = shortSide < UPSCALE_MIN_SHORT_SIDE ? UPSCALE_MIN_SHORT_SIDE / shortSide : 1;
    const targetW = Math.max(1, Math.round(sourceW * upscale));
    const targetH = Math.max(1, Math.round(sourceH * upscale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(src);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, targetW, targetH);

    if (upscale > 1) {
      runSharpenPass(ctx, targetW, targetH);
    }

    return new Promise((resolve) => {
      const prepared = new Image();
      prepared.onload = () => resolve(prepared);
      prepared.src = canvas.toDataURL('image/png');
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      const img = new Image();
      img.src = result;
      img.onload = async () => {
        const sourceW = Math.max(1, img.naturalWidth || img.width);
        const sourceH = Math.max(1, img.naturalHeight || img.height);
        const shortSide = Math.min(sourceW, sourceH);
        const pixels = sourceW * sourceH;
        const { blockShortSide, blockPixels, warnShortSide, warnPixels } = getQualityThresholds(settings.pieceCount);

        if (shortSide < blockShortSide || pixels < blockPixels) {
          setImageNotice(
            `This image is too small for ${settings.pieceCount} pieces. Please use at least ${blockShortSide}px on the short side (about ${Math.round(blockPixels / 100_000) / 10}MP).`
          );
          return;
        }

        if (shortSide < warnShortSide || pixels < warnPixels) {
          setImageNotice(
            `Image quality is a bit low for ${settings.pieceCount} pieces. We enhanced it automatically. For best results, use at least ${warnShortSide}px on the short side.`
          );
        } else {
          setImageNotice(null);
        }

        const preparedImage = await buildPuzzleReadyImage(img);
        setSelectedImage(preparedImage.src);
        setImgElement(preparedImage);
        setFrameRect(DEFAULT_FRAME_RECT);
        setFrameShape('rect');
      };
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const beginFrameInteraction = (
    e: React.PointerEvent<HTMLDivElement>,
    mode: 'move' | 'resize',
    handle?: ResizeHandle
  ) => {
    if (!frameMetrics || !imgElement) return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    frameInteractionRef.current = {
      mode,
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: frameRect,
      startShape: frameShape,
    };

    previewAreaRef.current?.setPointerCapture?.(e.pointerId);
  };

  const applyRectResize = (startRect: FrameRect, handle: ResizeHandle, dx: number, dy: number) => {
    let left = startRect.x;
    let right = startRect.x + startRect.w;
    let top = startRect.y;
    let bottom = startRect.y + startRect.h;

    if (handle.includes('w')) left += dx;
    if (handle.includes('e')) right += dx;
    if (handle.includes('n')) top += dy;
    if (handle.includes('s')) bottom += dy;

    left = clamp(left, 0, 1 - FRAME_MIN_SIZE);
    top = clamp(top, 0, 1 - FRAME_MIN_SIZE);
    right = clamp(right, FRAME_MIN_SIZE, 1);
    bottom = clamp(bottom, FRAME_MIN_SIZE, 1);

    if (right - left < FRAME_MIN_SIZE) {
      if (handle.includes('w')) left = right - FRAME_MIN_SIZE;
      else right = left + FRAME_MIN_SIZE;
    }

    if (bottom - top < FRAME_MIN_SIZE) {
      if (handle.includes('n')) top = bottom - FRAME_MIN_SIZE;
      else bottom = top + FRAME_MIN_SIZE;
    }

    return clampFrameRect({
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    });
  };

  const applyUniformResize = (
    startRect: FrameRect,
    handle: ResizeHandle,
    dx: number,
    dy: number,
    aspect: number,
    metricsWidth: number,
    metricsHeight: number
  ) => {
    const cx = startRect.x + startRect.w / 2;
    const cy = startRect.y + startRect.h / 2;
    const startHalfPx = (startRect.w * metricsWidth) / 2;

    let nextHalfPx = startHalfPx;
    if (handle === 'n') nextHalfPx = startHalfPx - dy * metricsHeight;
    else if (handle === 's') nextHalfPx = startHalfPx + dy * metricsHeight;
    else if (handle === 'w') nextHalfPx = startHalfPx - dx * metricsWidth;
    else if (handle === 'e') nextHalfPx = startHalfPx + dx * metricsWidth;
    else {
      const axisDeltaPx = Math.max(Math.abs(dx * metricsWidth), Math.abs(dy * metricsHeight));
      nextHalfPx = startHalfPx + axisDeltaPx * Math.sign(dx + dy || 1);
    }

    const halfWNorm = nextHalfPx / Math.max(1, metricsWidth);
    return createUniformShapeRect(cx, cy, halfWNorm, aspect);
  };

  const handleFramePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const interaction = frameInteractionRef.current;
    if (!interaction || !frameMetrics) return;

    e.preventDefault();

    const dx = (e.clientX - interaction.startClientX) / Math.max(1, frameMetrics.width);
    const dy = (e.clientY - interaction.startClientY) / Math.max(1, frameMetrics.height);

    if (interaction.mode === 'move') {
      const moved = clampFrameRect({
        ...interaction.startRect,
        x: interaction.startRect.x + dx,
        y: interaction.startRect.y + dy,
      });
      const normalized = normalizeFrameForShape(moved, interaction.startShape, activeImageAspect);
      setFrameRect(normalized);
      return;
    }

    if (!interaction.handle) return;

    if (interaction.startShape === 'rect') {
      setFrameRect(applyRectResize(interaction.startRect, interaction.handle, dx, dy));
      return;
    }

    setFrameRect(
      applyUniformResize(
        interaction.startRect,
        interaction.handle,
        dx,
        dy,
        activeImageAspect,
        frameMetrics.width,
        frameMetrics.height
      )
    );
  };

  const endFrameInteraction = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e) {
      try {
        previewAreaRef.current?.releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
    }
    frameInteractionRef.current = null;
  };

  const selectPieceCount = (count: number) => {
    setSettings((s) => ({
      ...s,
      pieceCount: count,
      irregularMode: false,
    }));
  };

  const selectIrregular300 = () => {
    setSettings((s) => ({
      ...s,
      pieceCount: 300,
      irregularMode: true,
    }));
  };

  const selectFrameShape = (shape: FrameShape) => {
    setFrameShape(shape);
    setFrameRect((prev) => normalizeFrameForShape(prev, shape, activeImageAspect));
  };

  const handleStartClick = async () => {
    if (!imgElement || isPreparingStart) return;
    const useFrameTools = settings.pieceCount >= 300;

    setIsPreparingStart(true);
    try {
      let normalizedRect: FrameRect = { x: 0, y: 0, w: 1, h: 1 };
      let selectedShape: FrameShape = 'rect';
      let playImage: HTMLImageElement = imgElement;

      if (useFrameTools) {
        const sourceAspect = imgElement.width / Math.max(1, imgElement.height);
        normalizedRect = normalizeFrameForShape(frameRect, frameShape, sourceAspect);
        selectedShape = frameShape;
        playImage = await buildFrameLockedImage(
          imgElement,
          normalizedRect,
          selectedShape,
          selectedShape !== 'rect'
        );
      }
      const startSettings: GameSettings = { ...settings };

      onStart({
        playImage,
        sourceImage: imgElement,
        settings: startSettings,
        frame: {
          rect: normalizedRect,
          shape: selectedShape,
        },
      });
    } finally {
      setIsPreparingStart(false);
    }
  };

  const showFrameTools = !!imgElement && settings.pieceCount >= 300;
  const isShapeRect = frameShape === 'rect';

  const resizeHandles: Array<{ key: ResizeHandle; x: number; y: number; cursor: string }> = useMemo(() => {
    if (!framePixels) return [];

    if (isShapeRect) {
      return [
        { key: 'nw', x: framePixels.x, y: framePixels.y, cursor: 'nwse-resize' },
        { key: 'n', x: framePixels.cx, y: framePixels.y, cursor: 'ns-resize' },
        { key: 'ne', x: framePixels.x + framePixels.w, y: framePixels.y, cursor: 'nesw-resize' },
        { key: 'e', x: framePixels.x + framePixels.w, y: framePixels.cy, cursor: 'ew-resize' },
        { key: 'se', x: framePixels.x + framePixels.w, y: framePixels.y + framePixels.h, cursor: 'nwse-resize' },
        { key: 's', x: framePixels.cx, y: framePixels.y + framePixels.h, cursor: 'ns-resize' },
        { key: 'sw', x: framePixels.x, y: framePixels.y + framePixels.h, cursor: 'nesw-resize' },
        { key: 'w', x: framePixels.x, y: framePixels.cy, cursor: 'ew-resize' },
      ];
    }

    const anchors = NON_RECT_SHAPE_ANCHORS[frameShape as Exclude<FrameShape, 'rect'>];
    return [
      {
        key: 'n',
        x: framePixels.x + framePixels.w * anchors.n[0],
        y: framePixels.y + framePixels.h * anchors.n[1],
        cursor: 'ns-resize',
      },
      {
        key: 'e',
        x: framePixels.x + framePixels.w * anchors.e[0],
        y: framePixels.y + framePixels.h * anchors.e[1],
        cursor: 'ew-resize',
      },
      {
        key: 's',
        x: framePixels.x + framePixels.w * anchors.s[0],
        y: framePixels.y + framePixels.h * anchors.s[1],
        cursor: 'ns-resize',
      },
      {
        key: 'w',
        x: framePixels.x + framePixels.w * anchors.w[0],
        y: framePixels.y + framePixels.h * anchors.w[1],
        cursor: 'ew-resize',
      },
    ];
  }, [framePixels, frameShape, isShapeRect]);

  return (
    <div className="h-screen w-full overflow-y-auto bg-[#1a110d] bg-[url('https://www.transparenttextures.com/patterns/dark-wood.png')] text-[#e6d5c3]">
      <div className="sticky top-0 z-20 w-full h-16 bg-gradient-to-b from-[#2e1d15] to-[#2e1d15]/85 flex justify-center items-center border-b border-[#5c3a2a]">
        <div className="bg-[#3e2723] px-12 py-2 border-x-4 border-b-4 border-[#8B4513] rounded-b-lg shadow-lg relative">
          <div className="absolute top-1 left-2 w-2 h-2 rounded-full bg-[#c8a656]" />
          <div className="absolute top-1 right-2 w-2 h-2 rounded-full bg-[#c8a656]" />
          <h1 className="text-2xl font-bold text-[#F2D086] tracking-widest uppercase text-shadow-sm">Jigsawcraft</h1>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <div className="flex flex-col xl:flex-row gap-6 xl:gap-8 items-start">
        <div className="flex-1 w-full xl:max-w-3xl flex flex-col items-center">
          <div
            ref={previewAreaRef}
            className="group w-full h-[min(54vh,560px)] min-h-[280px] bg-[#0c0907] border-4 border-[#5c3a2a] rounded-lg shadow-[inset_0_0_20px_rgba(0,0,0,0.8)] flex items-center justify-center relative overflow-hidden"
            onPointerMove={handleFramePointerMove}
            onPointerUp={endFrameInteraction}
            onPointerCancel={endFrameInteraction}
          >
            {selectedImage ? (
              <img src={selectedImage} alt="Preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-[#5c3a2a] flex flex-col items-center">
                <ImageIcon size={64} className="mb-4 opacity-50" />
                <span className="font-serif italic text-lg opacity-50">No image selected</span>
              </div>
            )}

            {!imgElement && (
              <div
                className="absolute inset-0 bg-black/60 flex items-center justify-center cursor-pointer backdrop-blur-sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex items-center gap-2 text-[#F2D086] border-2 border-[#F2D086] px-6 py-3 rounded-full hover:bg-[#F2D086]/20 transition-colors">
                  <Upload size={20} />
                  <span>Choose Image</span>
                </div>
              </div>
            )}

            {imgElement && settings.pieceCount <= 100 && (
              <div className="absolute inset-0 z-40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-black/25 flex items-center justify-center pointer-events-none">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="pointer-events-auto flex items-center gap-2 text-[#F2D086] border-2 border-[#F2D086] px-5 py-2 rounded-full bg-[#1a110d]/65"
                >
                  <Upload size={18} />
                  <span>Replace Image</span>
                </button>
              </div>
            )}

            {showFrameTools && framePixels && overlayPaths && (
              <>
                <svg
                  className="absolute inset-0 z-10 pointer-events-none"
                  viewBox={`0 0 ${previewAreaSize.width} ${previewAreaSize.height}`}
                  preserveAspectRatio="none"
                >
                  <path d={overlayPaths.dim} fill="rgba(0, 0, 0, 0.56)" fillRule="evenodd" />
                  <path d={overlayPaths.inner} fill="rgba(242, 208, 134, 0.10)" />
                  <path d={overlayPaths.inner} fill="none" stroke="rgba(246, 220, 146, 0.98)" strokeWidth={2.6} />
                  <path d={overlayPaths.inner} fill="none" stroke="rgba(35, 22, 17, 0.95)" strokeWidth={1.1} />
                </svg>

                <div
                  className="absolute z-20 cursor-move"
                  style={{
                    left: framePixels.x,
                    top: framePixels.y,
                    width: framePixels.w,
                    height: framePixels.h,
                    clipPath: getShapeClipPath(frameShape),
                  }}
                  onPointerDown={(e) => beginFrameInteraction(e, 'move')}
                />

                {resizeHandles.map((handle) => (
                  <div
                    key={handle.key}
                    className="absolute z-30 w-4 h-4 rounded-full bg-[#F2D086] border border-[#221611] shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                    style={{
                      left: handle.x - 8,
                      top: handle.y - 8,
                      cursor: handle.cursor,
                    }}
                    onPointerDown={(e) => beginFrameInteraction(e, 'resize', handle.key)}
                  />
                ))}
              </>
            )}
          </div>

          <p className="mt-4 text-[#8B4513] text-sm italic">Tip: use higher-resolution images for 500+ pieces.</p>

          {showFrameTools && (
            <div className="mt-3 w-full rounded border border-[#5c3a2a] bg-[#2c1e16]/80 p-3 text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[#d4b491] font-bold">Frame Tools</span>
              </div>

              <p className="text-xs text-[#b7926f] mb-2">
                Drag to move the frame. Resize with handles ({isShapeRect ? 'corners + edges' : 'N/E/S/W on the shape'}) to choose your puzzle area.
              </p>

              <div className="grid grid-cols-2 gap-2 mb-3">
                {FRAME_SHAPES.map((shape) => (
                  <button
                    key={shape.key}
                    type="button"
                    onClick={() => selectFrameShape(shape.key)}
                    className={`px-2 py-2 rounded border text-xs transition-colors ${
                      frameShape === shape.key
                        ? 'bg-[#5c3a2a] border-[#F2D086] text-[#F2D086]'
                        : 'border-[#4a3227] text-[#d4b491] hover:bg-[#3e2723]'
                    }`}
                  >
                    {shape.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFrameRect(DEFAULT_FRAME_RECT);
                    setFrameShape('rect');
                  }}
                  className="px-2 py-2 rounded border border-[#4a3227] text-xs text-[#d4b491] hover:bg-[#3e2723]"
                >
                  Reset
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-2 rounded border text-xs border-[#F2D086] text-[#F2D086] hover:bg-[#5c3a2a]"
                >
                  Replace Image
                </button>

              </div>
            </div>
          )}

          {imageNotice && (
            <p className={`mt-2 text-sm ${imgElement ? 'text-amber-300' : 'text-red-300'}`}>{imageNotice}</p>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
        </div>

        <div className="w-full xl:w-96 bg-[#2c1e16]/90 p-6 md:p-8 rounded-lg border border-[#5c3a2a] shadow-2xl backdrop-blur-sm">
          <h2 className="text-xl font-bold text-[#F2D086] mb-6 flex items-center gap-2 border-b border-[#5c3a2a] pb-4">
            <Settings size={20} /> Configuration
          </h2>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[#d4b491] font-bold block">Difficulty (Count)</label>
              <div className="grid grid-cols-2 gap-2">
                {ALLOWED_PIECE_COUNTS.map((count) => (
                  <button
                    key={count}
                    onClick={() => selectPieceCount(count)}
                    className={`px-4 py-3 border rounded transition-all flex flex-col items-center ${
                      settings.pieceCount === count && !settings.irregularMode
                        ? 'bg-[#5c3a2a] border-[#F2D086] text-[#F2D086] shadow-[0_0_10px_#F2D08640]'
                        : 'bg-transparent border-[#4a3227] text-[#8a6b58] hover:border-[#6a4a3a] hover:bg-[#3e2723]'
                    }`}
                  >
                    <span className="font-bold text-lg">{count}</span>
                    <span className="text-xs opacity-70 uppercase tracking-wider">{getDifficultyLabel(count)}</span>
                  </button>
                ))}

                <button
                  onClick={selectIrregular300}
                  className={`px-4 py-3 border rounded transition-all flex flex-col items-center ${
                    settings.pieceCount === 300 && settings.irregularMode
                      ? 'bg-[#5c3a2a] border-[#F2D086] text-[#F2D086] shadow-[0_0_10px_#F2D08640]'
                      : 'bg-transparent border-[#4a3227] text-[#8a6b58] hover:border-[#6a4a3a] hover:bg-[#3e2723]'
                  }`}
                >
                  <span className="font-bold text-lg">300</span>
                  <span className="text-xs opacity-70 uppercase tracking-wider">Irregular</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-[#4a3227]">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-[#d4b491] group-hover:text-white transition-colors">Ghost Image</span>
                <input
                  type="checkbox"
                  checked={settings.showGhost}
                  onChange={(e) => setSettings((s) => ({ ...s, showGhost: e.target.checked }))}
                  className="w-5 h-5 accent-[#8B4513] cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-[#d4b491] group-hover:text-white transition-colors">Piece Rotation</span>
                <input
                  type="checkbox"
                  checked={settings.rotationEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, rotationEnabled: e.target.checked }))}
                  className="w-5 h-5 accent-[#8B4513] cursor-pointer"
                />
              </label>
            </div>

            <div className="pt-8">
              <Button
                className="w-full h-16 text-xl"
                disabled={!imgElement || isPreparingStart}
                onClick={handleStartClick}
              >
                {isPreparingStart ? 'Preparing...' : `Start Puzzle (${settings.pieceCount})`}
              </Button>

              {!imgElement && <p className="text-center text-red-400/70 mt-2 text-sm">Please upload an image first</p>}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
