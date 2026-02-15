import { Point, PuzzleGenerationResult, PuzzlePiece, PuzzlePieceEdgeRef, SharedEdgeData, SnapPoint } from '../types';

const QUANT = 10000;
const EPS = 1e-6;

type Polygon = Point[];

type PieceBuildContext = {
  id: number;
  cell: Polygon;
  edges: PuzzlePieceEdgeRef[];
  neighbors: number[];
};

type EdgeOccurrence = {
  pieceId: number;
  edgeIndex: number;
  start: Point;
  end: Point;
  startKey: string;
  endKey: string;
};

const DEFAULT_TABS = {
  topPos: 0.5,
  rightPos: 0.5,
  bottomPos: 0.5,
  leftPos: 0.5,
  topVar: [1, 1, 0] as [number, number, number],
  rightVar: [1, 1, 0] as [number, number, number],
  bottomVar: [1, 1, 0] as [number, number, number],
  leftVar: [1, 1, 0] as [number, number, number],
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const pointKey = (p: Point) => `${Math.round(p.x * QUANT)}:${Math.round(p.y * QUANT)}`;

const edgeKey = (aKey: string, bKey: string) => (aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`);

const parsePointKey = (key: string): Point => {
  const [sx, sy] = key.split(':');
  return { x: Number(sx) / QUANT, y: Number(sy) / QUANT };
};

const polygonArea = (poly: Polygon) => {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
};

const ensureCCW = (poly: Polygon) => {
  if (poly.length < 3) return poly.slice();
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly.slice();
};

const polygonCentroid = (poly: Polygon) => {
  let areaTerm = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    areaTerm += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }

  if (Math.abs(areaTerm) < EPS) {
    const avg = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: avg.x / Math.max(1, poly.length), y: avg.y / Math.max(1, poly.length) };
  }

  const inv = 1 / (3 * areaTerm);
  return { x: cx * inv, y: cy * inv };
};

const intersectSegmentWithLine = (a: Point, b: Point, mid: Point, normal: Point): Point => {
  const da = (a.x - mid.x) * normal.x + (a.y - mid.y) * normal.y;
  const db = (b.x - mid.x) * normal.x + (b.y - mid.y) * normal.y;
  const denom = da - db;
  if (Math.abs(denom) < EPS) {
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  }
  const t = da / (da - db);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
};

const clipPolygonAgainstBisector = (poly: Polygon, seedA: Point, seedB: Point): Polygon => {
  if (poly.length === 0) return [];

  const mid = { x: (seedA.x + seedB.x) * 0.5, y: (seedA.y + seedB.y) * 0.5 };
  const normal = { x: seedB.x - seedA.x, y: seedB.y - seedA.y };

  const inside = (p: Point) => (p.x - mid.x) * normal.x + (p.y - mid.y) * normal.y <= EPS;

  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const currIn = inside(curr);
    const prevIn = inside(prev);

    if (prevIn && currIn) {
      out.push(curr);
    } else if (prevIn && !currIn) {
      out.push(intersectSegmentWithLine(prev, curr, mid, normal));
    } else if (!prevIn && currIn) {
      out.push(intersectSegmentWithLine(prev, curr, mid, normal));
      out.push(curr);
    }
  }

  if (out.length <= 1) return [];
  return out;
};

const generateVoronoiCells = (domain: Polygon, seeds: Point[]): Polygon[] => {
  const cells: Polygon[] = [];
  for (let i = 0; i < seeds.length; i++) {
    let cell = domain.slice();
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      cell = clipPolygonAgainstBisector(cell, seeds[i], seeds[j]);
      if (cell.length < 3) break;
    }
    cells.push(ensureCCW(cell));
  }
  return cells;
};

const generateJitteredSeeds = (width: number, height: number, count: number, jitterStrength: number): Point[] => {
  const seeds: Point[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * width) / Math.max(1, height))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  const jitter = clamp(jitterStrength, 0.05, 0.95);
  const pad = (1 - jitter) * 0.5;

  for (let r = 0; r < rows && seeds.length < count; r++) {
    for (let c = 0; c < cols && seeds.length < count; c++) {
      const x = (c + pad + Math.random() * jitter) * cellW;
      const y = (r + pad + Math.random() * jitter) * cellH;
      seeds.push({ x, y });
    }
  }

  return seeds;
};

const generateRadialSeeds = (width: number, height: number, count: number): Point[] => {
  const seeds: Point[] = [];
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.min(width, height) * 0.48;

  if (count <= 1) return [{ x: cx, y: cy }];

  seeds.push({ x: cx, y: cy });
  let ring = 1;
  while (seeds.length < count) {
    const radius = (ring / Math.max(2, Math.sqrt(count))) * maxR;
    const circumference = Math.max(1, 2 * Math.PI * Math.max(radius, 1));
    const pointsOnRing = Math.max(6, Math.round(circumference / Math.max(20, maxR * 0.08)));
    const angleOffset = Math.random() * Math.PI * 2;

    for (let i = 0; i < pointsOnRing && seeds.length < count; i++) {
      const t = i / pointsOnRing;
      const angle = angleOffset + t * Math.PI * 2;
      const radialJitter = (Math.random() - 0.5) * maxR * 0.03;
      const tangentialJitter = (Math.random() - 0.5) * maxR * 0.015;
      const r = clamp(radius + radialJitter, 0, maxR);
      const x = cx + Math.cos(angle) * r - Math.sin(angle) * tangentialJitter;
      const y = cy + Math.sin(angle) * r + Math.cos(angle) * tangentialJitter;
      seeds.push({
        x: clamp(x, 0, width),
        y: clamp(y, 0, height),
      });
    }
    ring += 1;
  }

  return seeds.slice(0, count);
};

const generateHybridRadialSeeds = (width: number, height: number, count: number): Point[] => {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const minSide = Math.min(width, height);
  const coreRadius = minSide * 0.36;
  const coreCount = Math.max(12, Math.round(count * 0.42));
  const outerCount = Math.max(0, count - coreCount);

  const coreSeeds = generateRadialSeeds(width, height, coreCount).map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const r = Math.hypot(dx, dy);
    if (r <= coreRadius || r < EPS) return p;
    const scale = coreRadius / r;
    return { x: cx + dx * scale, y: cy + dy * scale };
  });

  const outerSeeds: Point[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt((outerCount * width) / Math.max(1, height))));
  const rows = Math.max(1, Math.ceil(outerCount / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  const guardR = coreRadius * 0.95;
  const maxTries = Math.max(outerCount * 12, 80);
  let tries = 0;
  for (let r = 0; r < rows && outerSeeds.length < outerCount && tries < maxTries; r++) {
    for (let c = 0; c < cols && outerSeeds.length < outerCount && tries < maxTries; c++) {
      tries += 1;
      const x = (c + 0.12 + Math.random() * 0.76) * cellW;
      const y = (r + 0.12 + Math.random() * 0.76) * cellH;
      if (Math.hypot(x - cx, y - cy) < guardR) continue;
      outerSeeds.push({ x, y });
    }
  }

  while (outerSeeds.length < outerCount) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    if (Math.hypot(x - cx, y - cy) < guardR) continue;
    outerSeeds.push({ x, y });
  }

  return [...coreSeeds, ...outerSeeds].slice(0, count);
};

const getIrregularProfile = (): IrregularProfile => ({
  // Fixed irregular profile: puzzle-like (jigsaw) for consistent gameplay.
  seedJitter: 0.12,
  relaxIterations: 0,
  waveScale: 0.004,
  waveBlend: 0.02,
  tabProbability: 0.99,
  tabAmplitudeScale: 0.11,
  tabAmplitudeMin: 2.2,
  tabAmplitudeMax: 10.5,
  tabWidthMin: 0.22,
  tabWidthMax: 0.32,
});

const runLloydRelaxation = (domain: Polygon, seeds: Point[], width: number, height: number, iterations: number): Point[] => {
  let current = seeds.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const cells = generateVoronoiCells(domain, current);
    current = cells.map((cell, idx) => {
      if (cell.length < 3) return current[idx];
      const c = polygonCentroid(cell);
      return {
        x: clamp(c.x, 0, width),
        y: clamp(c.y, 0, height),
      };
    });
  }
  return current;
};

const buildStraightCurve = (a: Point, b: Point): Point[] => [
  { x: a.x, y: a.y },
  { x: b.x, y: b.y },
];

const smoothBell = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

const buildSharedCurve = (
  a: Point,
  b: Point,
  enableTab: boolean,
  profile: IrregularProfile
): { points: Point[]; tabProfile?: SharedEdgeData['tabProfile'] } => {
  const length = dist(a, b);
  if (length < 4) {
    return { points: buildStraightCurve(a, b) };
  }

  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const normal = { x: -dir.y, y: dir.x };
  const samples = Math.max(12, Math.min(42, Math.round(length / 8)));

  const waveAmp = clamp(length * profile.waveScale, 0.5, 5.5);
  const phaseA = Math.random() * Math.PI * 2;
  const phaseB = Math.random() * Math.PI * 2;

  const hasTab = enableTab && Math.random() < profile.tabProbability;
  const tabCenter = 0.35 + Math.random() * 0.3;
  const tabWidth = profile.tabWidthMin + Math.random() * (profile.tabWidthMax - profile.tabWidthMin);
  const tabSign = Math.random() < 0.5 ? -1 : 1;
  const tabAmplitude = hasTab
    ? tabSign * clamp(length * profile.tabAmplitudeScale, profile.tabAmplitudeMin, profile.tabAmplitudeMax)
    : 0;

  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const base = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    const fade = Math.sin(Math.PI * t);
    let wave =
      Math.sin((t * Math.PI * 2) + phaseA) * waveAmp * profile.waveBlend * fade +
      Math.sin((t * Math.PI * 4) + phaseB) * waveAmp * (profile.waveBlend * 0.5) * fade;

    wave =
      Math.sin((t * Math.PI * 2) + phaseA) * waveAmp * 0.03 * fade +
      Math.sin((t * Math.PI * 6) + phaseB) * waveAmp * 0.02 * fade;

    let tab = 0;
    if (hasTab) {
      const halfW = tabWidth * 0.5;
      const local = (t - tabCenter) / Math.max(halfW, EPS);
      if (Math.abs(local) < 1) {
        const p = Math.max(0, 1 - local * local);
        let envelope = smoothBell(p);

        // Classic, symmetric neck/head silhouette.
        const neck = Math.abs(local) > 0.72 ? 0.35 : 1;
        envelope = Math.pow(p, 1.8) * neck;
        tab = tabAmplitude * envelope;
      }
    }

    const offset = wave + tab;
    points.push({
      x: base.x + normal.x * offset,
      y: base.y + normal.y * offset,
    });
  }

  points[0] = { x: a.x, y: a.y };
  points[points.length - 1] = { x: b.x, y: b.y };

  return {
    points,
    tabProfile: hasTab
      ? {
          center: tabCenter,
          width: tabWidth,
          amplitude: tabAmplitude,
        }
      : undefined,
  };
};

const appendPolyline = (target: Point[], source: Point[]) => {
  if (source.length === 0) return;
  if (target.length === 0) {
    source.forEach((p) => target.push({ x: p.x, y: p.y }));
    return;
  }

  const first = source[0];
  const last = target[target.length - 1];
  const startIndex = dist(first, last) < 1e-4 ? 1 : 0;
  for (let i = startIndex; i < source.length; i++) {
    target.push({ x: source[i].x, y: source[i].y });
  }
};

const dedupeBoundary = (boundary: Point[]) => {
  if (boundary.length < 2) return boundary;
  const out: Point[] = [boundary[0]];
  for (let i = 1; i < boundary.length; i++) {
    if (dist(boundary[i], out[out.length - 1]) > 1e-4) out.push(boundary[i]);
  }
  if (out.length > 2 && dist(out[0], out[out.length - 1]) < 1e-4) {
    out.pop();
  }
  return out;
};

type IrregularProfile = {
  seedJitter: number;
  relaxIterations: number;
  waveScale: number;
  waveBlend: number;
  tabProbability: number;
  tabAmplitudeScale: number;
  tabAmplitudeMin: number;
  tabAmplitudeMax: number;
  tabWidthMin: number;
  tabWidthMax: number;
};

const polygonAreaAbs = (poly: Point[]) => Math.abs(polygonArea(poly));

const validateIrregularOutput = (
  pieces: PuzzlePiece[],
  sharedEdges: Record<string, SharedEdgeData>,
  width: number,
  height: number
) => {
  const domainArea = width * height;
  const edgeRefCount = new Map<string, number>();
  let totalArea = 0;

  for (const piece of pieces) {
    if (piece.edges) {
      for (const edge of piece.edges) {
        edgeRefCount.set(edge.edgeId, (edgeRefCount.get(edge.edgeId) || 0) + 1);
      }
    }

    if (piece.boundary && piece.boundary.length >= 3) {
      const globalBoundary = piece.boundary.map((p) => ({
        x: piece.targetPos.x + p.x,
        y: piece.targetPos.y + p.y,
      }));
      totalArea += polygonAreaAbs(globalBoundary);
    }
  }

  let edgeInvariantOk = true;
  for (const [edgeId, edge] of Object.entries(sharedEdges)) {
    const expected = edge.rightPieceId == null ? 1 : 2;
    const actual = edgeRefCount.get(edgeId) || 0;
    if (actual !== expected) {
      edgeInvariantOk = false;
      break;
    }
  }

  const areaError = Math.abs(totalArea - domainArea);
  const areaOk = areaError <= Math.max(2.5, domainArea * 0.0025);

  return {
    ok: edgeInvariantOk && areaOk,
    edgeInvariantOk,
    areaOk,
    areaError,
    domainArea,
  };
};

const createDefaultShape = () => ({ top: 0, right: 0, bottom: 0, left: 0 });

const buildRegularPieces = (imageWidth: number, imageHeight: number, rows: number, cols: number): PuzzlePiece[] => {
  const pieces: PuzzlePiece[] = [];
  const pieceWidth = imageWidth / cols;
  const pieceHeight = imageHeight / rows;

  interface EdgeDef {
    type: number;
    pos: number;
    var: [number, number, number];
  }

  const defaultVar: [number, number, number] = [1, 1, 0];
  const isTestMode = rows * cols <= 50;

  const verticalEdges: EdgeDef[][] = Array.from({ length: rows }, () =>
    Array.from({ length: Math.max(0, cols - 1) }, () => ({ type: 0, pos: 0.5, var: defaultVar }))
  );
  const horizontalEdges: EdgeDef[][] = Array.from({ length: Math.max(0, rows - 1) }, () =>
    Array.from({ length: cols }, () => ({ type: 0, pos: 0.5, var: defaultVar }))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      verticalEdges[r][c] = {
        type: isTestMode ? 0 : Math.random() > 0.5 ? 1 : -1,
        pos: 0.4 + Math.random() * 0.2,
        var: [0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2],
      };
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      horizontalEdges[r][c] = {
        type: isTestMode ? 0 : Math.random() > 0.5 ? 1 : -1,
        pos: 0.4 + Math.random() * 0.2,
        var: [0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2],
      };
    }
  }

  let idCounter = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const topEdge = r === 0 ? null : horizontalEdges[r - 1][c];
      const rightEdge = c === cols - 1 ? null : verticalEdges[r][c];
      const bottomEdge = r === rows - 1 ? null : horizontalEdges[r][c];
      const leftEdge = c === 0 ? null : verticalEdges[r][c - 1];

      const shape = {
        top: topEdge ? -topEdge.type : 0,
        right: rightEdge ? rightEdge.type : 0,
        bottom: bottomEdge ? bottomEdge.type : 0,
        left: leftEdge ? -leftEdge.type : 0,
      };

      const tabs = {
        topPos: topEdge ? topEdge.pos : 0.5,
        rightPos: rightEdge ? rightEdge.pos : 0.5,
        bottomPos: bottomEdge ? bottomEdge.pos : 0.5,
        leftPos: leftEdge ? leftEdge.pos : 0.5,
        topVar: topEdge ? topEdge.var : defaultVar,
        rightVar: rightEdge ? rightEdge.var : defaultVar,
        bottomVar: bottomEdge ? bottomEdge.var : defaultVar,
        leftVar: leftEdge ? leftEdge.var : defaultVar,
      };

      const randomOffsetX = (Math.random() - 0.5) * imageWidth * 1.5;
      const randomOffsetY = (Math.random() - 0.5) * imageHeight * 1.5;
      const rowSection = Math.min(2, Math.floor(r / (rows / 3 || 1)));
      const colSection = Math.min(2, Math.floor(c / (cols / 3 || 1)));

      const snapPoints: SnapPoint[] = [
        { id: `v_${r}_${c}`, x: 0, y: 0 },
        { id: `v_${r}_${c + 1}`, x: pieceWidth, y: 0 },
        { id: `v_${r + 1}_${c + 1}`, x: pieceWidth, y: pieceHeight },
        { id: `v_${r + 1}_${c}`, x: 0, y: pieceHeight },
      ];

      pieces.push({
        id: idCounter,
        correctRow: r,
        correctCol: c,
        currentPos: { x: imageWidth / 2 + randomOffsetX, y: imageHeight / 2 + randomOffsetY },
        targetPos: { x: c * pieceWidth, y: r * pieceHeight },
        width: pieceWidth,
        height: pieceHeight,
        shape,
        tabs,
        snapPoints,
        group: idCounter,
        isSolved: false,
        regionIndex: rowSection * 3 + colSection,
      });
      idCounter += 1;
    }
  }

  return pieces;
};

const buildIrregularPieces = (
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number
): PuzzleGenerationResult => {
  const count = Math.max(1, rows * cols);
  const profile = getIrregularProfile();
  const domain: Polygon = [
    { x: 0, y: 0 },
    { x: imageWidth, y: 0 },
    { x: imageWidth, y: imageHeight },
    { x: 0, y: imageHeight },
  ];

  const initialSeeds = generateJitteredSeeds(imageWidth, imageHeight, count, profile.seedJitter);
  const relaxedSeeds = runLloydRelaxation(domain, initialSeeds, imageWidth, imageHeight, profile.relaxIterations);
  const cells = generateVoronoiCells(domain, relaxedSeeds).map(ensureCCW);

  const pointAgg = new Map<string, { x: number; y: number; c: number }>();
  const edgeOccByKey = new Map<string, EdgeOccurrence[]>();

  cells.forEach((cell, pieceId) => {
    for (let i = 0; i < cell.length; i++) {
      const start = cell[i];
      const end = cell[(i + 1) % cell.length];
      const startKey = pointKey(start);
      const endKey = pointKey(end);

      const aggA = pointAgg.get(startKey) || { x: 0, y: 0, c: 0 };
      aggA.x += start.x;
      aggA.y += start.y;
      aggA.c += 1;
      pointAgg.set(startKey, aggA);

      const aggB = pointAgg.get(endKey) || { x: 0, y: 0, c: 0 };
      aggB.x += end.x;
      aggB.y += end.y;
      aggB.c += 1;
      pointAgg.set(endKey, aggB);

      const key = edgeKey(startKey, endKey);
      const list = edgeOccByKey.get(key) || [];
      list.push({ pieceId, edgeIndex: i, start, end, startKey, endKey });
      edgeOccByKey.set(key, list);
    }
  });

  const pointByKey = new Map<string, Point>();
  pointAgg.forEach((agg, key) => {
    pointByKey.set(key, { x: agg.x / agg.c, y: agg.y / agg.c });
  });

  const sharedEdges: Record<string, SharedEdgeData> = {};
  const pieceEdges: PuzzlePieceEdgeRef[][] = cells.map((cell) => Array(cell.length).fill(null as unknown as PuzzlePieceEdgeRef));
  const pieceNeighbors: Array<Set<number>> = cells.map(() => new Set<number>());

  let edgeIdCounter = 0;
  edgeOccByKey.forEach((occList, key) => {
    const [aKey, bKey] = key.split('|');
    const a = pointByKey.get(aKey) || parsePointKey(aKey);
    const b = pointByKey.get(bKey) || parsePointKey(bKey);
    const edgeId = `edge_${edgeIdCounter++}`;

    if (occList.length === 2) {
      const [leftOcc, rightOcc] = occList;
      const curve = buildSharedCurve(a, b, true, profile);
      sharedEdges[edgeId] = {
        leftPieceId: leftOcc.pieceId,
        rightPieceId: rightOcc.pieceId,
        curvePoints: curve.points,
        tabProfile: curve.tabProfile,
      };

      const leftDir = leftOcc.startKey === aKey && leftOcc.endKey === bKey ? 1 : -1;
      const rightDir = rightOcc.startKey === aKey && rightOcc.endKey === bKey ? 1 : -1;

      pieceEdges[leftOcc.pieceId][leftOcc.edgeIndex] = {
        edgeId,
        direction: leftDir as 1 | -1,
        neighborId: rightOcc.pieceId,
      };
      pieceEdges[rightOcc.pieceId][rightOcc.edgeIndex] = {
        edgeId,
        direction: rightDir as 1 | -1,
        neighborId: leftOcc.pieceId,
      };

      pieceNeighbors[leftOcc.pieceId].add(rightOcc.pieceId);
      pieceNeighbors[rightOcc.pieceId].add(leftOcc.pieceId);
    } else {
      const occ = occList[0];
      sharedEdges[edgeId] = {
        leftPieceId: occ.pieceId,
        rightPieceId: null,
        curvePoints: buildStraightCurve(a, b),
      };

      const direction = occ.startKey === aKey && occ.endKey === bKey ? 1 : -1;
      pieceEdges[occ.pieceId][occ.edgeIndex] = {
        edgeId,
        direction: direction as 1 | -1,
        neighborId: null,
      };
    }
  });

  const contexts: PieceBuildContext[] = cells.map((cell, id) => ({
    id,
    cell,
    edges: pieceEdges[id],
    neighbors: Array.from(pieceNeighbors[id]),
  }));

  const pieces: PuzzlePiece[] = contexts.map((ctx) => {
    const boundaryGlobal: Point[] = [];

    for (let i = 0; i < ctx.edges.length; i++) {
      const edgeRef = ctx.edges[i];
      if (!edgeRef) continue;
      const shared = sharedEdges[edgeRef.edgeId];
      const points = edgeRef.direction === 1 ? shared.curvePoints : [...shared.curvePoints].reverse();
      appendPolyline(boundaryGlobal, points);
    }

    const normalizedBoundary = dedupeBoundary(boundaryGlobal);
    const centroid = polygonCentroid(ctx.cell);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    normalizedBoundary.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const width = Math.max(2, maxX - minX);
    const height = Math.max(2, maxY - minY);
    const boundaryLocal = normalizedBoundary.map((p) => ({ x: p.x - minX, y: p.y - minY }));

    const snapPoints: SnapPoint[] = [];
    ctx.edges.forEach((edge) => {
      if (!edge || edge.neighborId == null) return;
      const shared = sharedEdges[edge.edgeId];
      const oriented = edge.direction === 1 ? shared.curvePoints : [...shared.curvePoints].reverse();
      const mid = oriented[Math.floor(oriented.length / 2)];
      const samples = [oriented[0], mid, oriented[oriented.length - 1]];
      const suffixes = ['s', 'm', 'e'];
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        snapPoints.push({
          id: `${edge.edgeId}:${suffixes[i]}`,
          x: p.x - minX,
          y: p.y - minY,
        });
      }
    });

    const randomOffsetX = (Math.random() - 0.5) * imageWidth * 1.5;
    const randomOffsetY = (Math.random() - 0.5) * imageHeight * 1.5;
    const correctRow = clamp(Math.floor((centroid.y / Math.max(1, imageHeight)) * rows), 0, Math.max(0, rows - 1));
    const correctCol = clamp(Math.floor((centroid.x / Math.max(1, imageWidth)) * cols), 0, Math.max(0, cols - 1));
    const regionRow = clamp(Math.floor((centroid.y / Math.max(1, imageHeight)) * 3), 0, 2);
    const regionCol = clamp(Math.floor((centroid.x / Math.max(1, imageWidth)) * 3), 0, 2);

    return {
      id: ctx.id,
      correctRow,
      correctCol,
      currentPos: {
        x: imageWidth / 2 + randomOffsetX,
        y: imageHeight / 2 + randomOffsetY,
      },
      targetPos: { x: minX, y: minY },
      width,
      height,
      shape: createDefaultShape(),
      tabs: DEFAULT_TABS,
      boundary: boundaryLocal,
      neighbors: ctx.neighbors,
      edges: ctx.edges,
      snapPoints,
      group: ctx.id,
      isSolved: false,
      regionIndex: regionRow * 3 + regionCol,
    };
  });

  const validation = validateIrregularOutput(pieces, sharedEdges, imageWidth, imageHeight);
  if (!validation.ok) {
    console.warn('[IRREGULAR] partition validation warning', validation);
  }

  return {
    pieces,
    sharedEdges,
  };
};

// Generate puzzle topology. For regular mode it returns empty sharedEdges.
export const generatePuzzlePieces = (
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  options?: { irregularMode?: boolean }
): PuzzleGenerationResult => {
  if (options?.irregularMode) {
    return buildIrregularPieces(imageWidth, imageHeight, rows, cols);
  }
  return {
    pieces: buildRegularPieces(imageWidth, imageHeight, rows, cols),
    sharedEdges: {},
  };
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
};

const createIrregularPath = (ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, boundary: Point[]) => {
  if (!boundary || boundary.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(offsetX + boundary[0].x, offsetY + boundary[0].y);
  for (let i = 1; i < boundary.length; i++) {
    ctx.lineTo(offsetX + boundary[i].x, offsetY + boundary[i].y);
  }
  ctx.closePath();
};

// Precompute each piece sprite texture for fast render.
export const generatePuzzleSprites = async (
  pieces: PuzzlePiece[],
  image: CanvasImageSource,
  options?: { spriteScale?: number }
): Promise<PuzzlePiece[]> => {
  const requestedScale = options?.spriteScale ?? (window.devicePixelRatio || 1);
  const spriteScale = Math.min(2, Math.max(0.6, requestedScale));

  const computedPieces: PuzzlePiece[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const p = pieces[index];
    const padding = Math.max(p.width, p.height) * 0.5;
    const logicalWidth = p.width + padding * 2;
    const logicalHeight = p.height + padding * 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(logicalWidth * spriteScale));
    canvas.height = Math.max(1, Math.round(logicalHeight * spriteScale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      computedPieces.push(p);
      continue;
    }

    ctx.setTransform(spriteScale, 0, 0, spriteScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const localX = padding;
    const localY = padding;

    ctx.save();
    if (p.boundary && p.boundary.length >= 3) {
      createIrregularPath(ctx, localX, localY, p.boundary);
    } else {
      createPuzzlePath(ctx, localX, localY, p.width, p.height, p.shape, p.tabs);
    }
    ctx.clip();

    ctx.fillStyle = '#000000';
    ctx.fillRect(localX - p.targetPos.x, localY - p.targetPos.y, p.width, p.height);
    ctx.drawImage(image, localX - p.targetPos.x, localY - p.targetPos.y);

    let avgColorHex = '#000000';
    let hsl: [number, number, number] = [0, 0, 0];
    try {
      const sampleW = Math.max(1, Math.floor(p.width / 2));
      const sampleH = Math.max(1, Math.floor(p.height / 2));
      const imgData = ctx.getImageData(localX + p.width / 4, localY + p.height / 4, sampleW, sampleH);
      const data = imgData.data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }
      if (count > 0) {
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        avgColorHex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        hsl = rgbToHsl(r, g, b);
      }
    } catch {
      // ignore sampling failures
    }

    ctx.restore();

    ctx.save();
    if (p.boundary && p.boundary.length >= 3) {
      createIrregularPath(ctx, localX, localY, p.boundary);
    } else {
      createPuzzlePath(ctx, localX, localY, p.width, p.height, p.shape, p.tabs);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    let spriteSource: ImageBitmap | HTMLCanvasElement = canvas;
    try {
      spriteSource = await createImageBitmap(canvas, { imageOrientation: 'flipY' });
    } catch {
      spriteSource = canvas;
    }

    computedPieces.push({
      ...p,
      cachedSprite: spriteSource,
      spriteOffset: { x: -padding, y: -padding },
      spriteScale,
      avgColor: avgColorHex,
      hsl,
    });

    if (index % 24 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return computedPieces;
};

// Build regular jigsaw path on canvas.
export const createPuzzlePath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: { top: number; right: number; bottom: number; left: number },
  tabs: {
    topPos: number;
    rightPos: number;
    bottomPos: number;
    leftPos: number;
    topVar: [number, number, number];
    rightVar: [number, number, number];
    bottomVar: [number, number, number];
    leftVar: [number, number, number];
  }
) => {
  const { top, right, bottom, left } = shape;
  const baseTabHeight = 0.25;
  const baseTabNeck = 0.22;
  const baseTabHead = 0.28;

  ctx.beginPath();
  ctx.moveTo(x, y);

  if (top === 0) {
    ctx.lineTo(x + w, y);
  } else {
    const [headScale, neckScale, skew] = tabs.topVar;
    const tabH = h * baseTabHeight * (top === 1 ? -1 : 1);
    const cx = x + w * tabs.topPos + w * skew;
    const neckW = w * baseTabNeck * neckScale;
    ctx.lineTo(cx - neckW, y);
    ctx.bezierCurveTo(cx - neckW, y + tabH * 0.8, cx - w * baseTabHead * headScale, y + tabH, cx, y + tabH);
    ctx.bezierCurveTo(cx + w * baseTabHead * headScale, y + tabH, cx + neckW, y + tabH * 0.8, cx + neckW, y);
    ctx.lineTo(x + w, y);
  }

  if (right === 0) {
    ctx.lineTo(x + w, y + h);
  } else {
    const [headScale, neckScale, skew] = tabs.rightVar;
    const tabW = w * baseTabHeight * (right === 1 ? 1 : -1);
    const cy = y + h * tabs.rightPos + h * skew;
    const neckH = h * baseTabNeck * neckScale;
    ctx.lineTo(x + w, cy - neckH);
    ctx.bezierCurveTo(x + w + tabW * 0.8, cy - neckH, x + w + tabW, cy - h * baseTabHead * headScale, x + w + tabW, cy);
    ctx.bezierCurveTo(x + w + tabW, cy + h * baseTabHead * headScale, x + w + tabW * 0.8, cy + neckH, x + w, cy + neckH);
    ctx.lineTo(x + w, y + h);
  }

  if (bottom === 0) {
    ctx.lineTo(x, y + h);
  } else {
    const [headScale, neckScale, skew] = tabs.bottomVar;
    const tabH = h * baseTabHeight * (bottom === 1 ? 1 : -1);
    const cx = x + w * tabs.bottomPos + w * skew;
    const neckW = w * baseTabNeck * neckScale;
    ctx.lineTo(cx + neckW, y + h);
    ctx.bezierCurveTo(cx + neckW, y + h + tabH * 0.8, cx + w * baseTabHead * headScale, y + h + tabH, cx, y + h + tabH);
    ctx.bezierCurveTo(cx - w * baseTabHead * headScale, y + h + tabH, cx - neckW, y + h + tabH * 0.8, cx - neckW, y + h);
    ctx.lineTo(x, y + h);
  }

  if (left === 0) {
    ctx.lineTo(x, y);
  } else {
    const [headScale, neckScale, skew] = tabs.leftVar;
    const tabW = w * baseTabHeight * (left === 1 ? -1 : 1);
    const cy = y + h * tabs.leftPos + h * skew;
    const neckH = h * baseTabNeck * neckScale;
    ctx.lineTo(x, cy + neckH);
    ctx.bezierCurveTo(x + tabW * 0.8, cy + neckH, x + tabW, cy + h * baseTabHead * headScale, x + tabW, cy);
    ctx.bezierCurveTo(x + tabW, cy - h * baseTabHead * headScale, x + tabW * 0.8, cy - neckH, x, cy - neckH);
    ctx.lineTo(x, y);
  }

  ctx.closePath();
};
