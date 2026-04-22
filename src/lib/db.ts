// Per-user data access layer on top of Prisma + Postgres.
//
// Every helper takes `userId` as the first argument so callers (server actions,
// RSC pages, API routes) scope reads and writes to the signed-in user — use
// `requireUserId()` from '@/lib/session' to get it. SQLite behaviour is
// preserved function-by-function; only the backend changed.
//
// DataForSEO credentials live in `UserCredential` with `dfsPassword` encrypted
// at rest via AES-256-GCM (see '@/lib/crypto'). Key/value settings
// (default_location, rank_tracker_depth, etc.) live in `UserSetting`.
//
// `ts` fields keep the existing ms-epoch `number` shape at the TS boundary; we
// convert to/from Prisma's `BigInt` inside each helper so callers don't have
// to think about it.

import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/crypto';

const toBigInt = (n: number) => BigInt(n);
const fromBigInt = (n: bigint) => Number(n);

// Prisma demands `Prisma.DbNull` (not JS `null`) for clearing a nullable Json
// column, and `Prisma.InputJsonValue` (not `object`) for a non-null payload.
// These two helpers keep the call sites readable.
const toJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const toNullableJson = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

// --- Settings ---

export async function getSetting(userId: string, key: string): Promise<string | null> {
  const row = await prisma.userSetting.findUnique({ where: { userId_key: { userId, key } } });
  return row?.value ?? null;
}

export async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await prisma.userSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  });
}

export async function deleteSetting(userId: string, key: string): Promise<void> {
  await prisma.userSetting.deleteMany({ where: { userId, key } });
}

// --- Credentials ---

export async function getCredentials(userId: string): Promise<{ login: string; pass: string } | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (!cred) return null;
  try {
    return { login: cred.dfsLogin, pass: decrypt(cred.dfsPassword) };
  } catch {
    // Corrupt ciphertext or wrong ENCRYPTION_KEY — treat as no creds rather than 500.
    return null;
  }
}

export async function saveCredentials(userId: string, login: string, pass: string): Promise<void> {
  const dfsPassword = encrypt(pass);
  await prisma.userCredential.upsert({
    where: { userId },
    update: { dfsLogin: login, dfsPassword },
    create: { userId, dfsLogin: login, dfsPassword },
  });
}

export async function clearCredentials(userId: string): Promise<void> {
  await prisma.userCredential.deleteMany({ where: { userId } });
}

// --- Target domains (SERP highlight list) ---

function cleanDomain(domain: string): string {
  return domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export async function getTargetDomains(userId: string): Promise<string[]> {
  const rows = await prisma.targetDomain.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { domain: true },
  });
  return rows.map((r) => r.domain);
}

export async function addTargetDomain(userId: string, domain: string): Promise<void> {
  const clean = cleanDomain(domain);
  await prisma.targetDomain.upsert({
    where: { userId_domain: { userId, domain: clean } },
    update: {},
    create: { userId, domain: clean },
  });
}

export async function removeTargetDomain(userId: string, domain: string): Promise<void> {
  await prisma.targetDomain.deleteMany({ where: { userId, domain } });
}

// --- SERP history ---

export interface TargetHit {
  domain: string;
  position: number;
}

export interface SerpHistoryEntry {
  id: string;
  ts: number;
  keyword: string;
  location: string;
  language: string;
  device: string;
  depth: number;
  count: number;
  targetHits?: TargetHit[];
}

export async function getSerpHistory(userId: string): Promise<SerpHistoryEntry[]> {
  const rows = await prisma.serpSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: {
      id: true, ts: true, keyword: true, location: true, language: true,
      device: true, depth: true, resultCount: true, targetHits: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keyword: r.keyword,
    location: r.location,
    language: r.language,
    device: r.device,
    depth: r.depth,
    count: r.resultCount,
    targetHits: (r.targetHits as TargetHit[] | null) ?? undefined,
  }));
}

export async function saveSerpSearch<T>(userId: string, entry: SerpHistoryEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keyword: entry.keyword,
    location: entry.location,
    language: entry.language,
    device: entry.device,
    depth: entry.depth,
    resultCount: entry.count,
    items: toJson(items),
    targetHits: toNullableJson(entry.targetHits),
  };
  await prisma.serpSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getSerpResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.serpSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Keyword Data history ---

export interface KdHistoryEntry {
  id: string;
  ts: number;
  se: string;
  seType: string;
  label: string;
  count: number;
  cost?: number;
  params: Record<string, string>;
}

export async function getKdHistory(userId: string): Promise<KdHistoryEntry[]> {
  const rows = await prisma.kdSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, se: true, seType: true, label: true, resultCount: true, cost: true, params: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    se: r.se,
    seType: r.seType,
    label: r.label,
    count: r.resultCount,
    cost: r.cost ?? undefined,
    params: r.params as Record<string, string>,
  }));
}

export async function saveKdSearch<T>(userId: string, entry: KdHistoryEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    se: entry.se,
    seType: entry.seType,
    label: entry.label,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    params: toJson(entry.params),
    items: toJson(items),
  };
  await prisma.kdSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getKdResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.kdSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Local Finder history ---

export interface LfHistoryEntry {
  id: string;
  ts: number;
  keyword: string;
  location: string;
  count: number;
  cost?: number;
  params: Record<string, string>;
}

export async function getLfHistory(userId: string): Promise<LfHistoryEntry[]> {
  const rows = await prisma.lfSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, keyword: true, location: true, resultCount: true, cost: true, params: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keyword: r.keyword,
    location: r.location,
    count: r.resultCount,
    cost: r.cost ?? undefined,
    params: r.params as Record<string, string>,
  }));
}

export async function saveLfSearch<T>(userId: string, entry: LfHistoryEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keyword: entry.keyword,
    location: entry.location,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    params: toJson(entry.params),
    items: toJson(items),
  };
  await prisma.lfSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getLfResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.lfSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- OnPage tasks ---

export interface OnpageTask {
  id: string;
  ts: number;
  url: string;
  target: string;
  status: 'pending' | 'in_progress' | 'finished' | 'error';
  cost?: number;
  errorMessage?: string;
}

export async function getOnpageTasks(userId: string): Promise<OnpageTask[]> {
  const rows = await prisma.onpageTask.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, url: true, target: true, status: true, cost: true, errorMessage: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    url: r.url,
    target: r.target,
    status: r.status as OnpageTask['status'],
    cost: r.cost ?? undefined,
    errorMessage: r.errorMessage ?? undefined,
  }));
}

export async function upsertOnpageTask(userId: string, task: OnpageTask): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(task.ts),
    url: task.url,
    target: task.target,
    status: task.status,
    cost: task.cost ?? null,
    errorMessage: task.errorMessage ?? null,
  };
  await prisma.onpageTask.upsert({
    where: { id: task.id },
    update: data,
    create: { id: task.id, ...data },
  });
}

export async function getOnpageResult<T>(userId: string, taskId: string): Promise<T | null> {
  const row = await prisma.onpageTask.findFirst({ where: { id: taskId, userId }, select: { result: true } });
  return (row?.result as T | null | undefined) ?? null;
}

export async function saveOnpageResult<T>(userId: string, taskId: string, result: T): Promise<void> {
  await prisma.onpageTask.updateMany({
    where: { id: taskId, userId },
    data: { result: toJson(result), status: 'finished' },
  });
}

// --- Ranked Keywords ---

export interface RankedKwSearchEntry {
  id: string;
  ts: number;
  target: string;
  location: string;
  language: string;
  count: number;
  totalCount: number;
  cost?: number;
}

export async function getRankedKwHistory(userId: string): Promise<RankedKwSearchEntry[]> {
  const rows = await prisma.rankedKwSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, location: true, language: true, resultCount: true, totalCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    location: r.location,
    language: r.language,
    count: r.resultCount,
    totalCount: r.totalCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveRankedKwSearch<T>(userId: string, entry: RankedKwSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    location: entry.location,
    language: entry.language,
    resultCount: entry.count,
    totalCount: entry.totalCount,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.rankedKwSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getRankedKwResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.rankedKwSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Keyword Overview ---

export interface KwOverviewSearchEntry {
  id: string;
  ts: number;
  keywords: string;
  location: string;
  language: string;
  count: number;
  cost?: number;
}

export async function getKwOverviewHistory(userId: string): Promise<KwOverviewSearchEntry[]> {
  const rows = await prisma.kwOverviewSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, keywords: true, location: true, language: true, resultCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keywords: r.keywords as unknown as string,
    location: r.location,
    language: r.language,
    count: r.resultCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveKwOverviewSearch<T>(userId: string, entry: KwOverviewSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keywords: toJson(entry.keywords),
    location: entry.location,
    language: entry.language,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.kwOverviewSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getKwOverviewResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.kwOverviewSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Backlinks ---

export interface BacklinksSearchEntry {
  id: string;
  ts: number;
  target: string;
  cost?: number;
  linksTotal?: number;
}

export async function getBacklinksHistory(userId: string): Promise<BacklinksSearchEntry[]> {
  const rows = await prisma.backlinksSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, cost: true, linksTotal: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    cost: r.cost ?? undefined,
    linksTotal: r.linksTotal ?? undefined,
  }));
}

export async function saveBacklinksSearch<T, L>(
  userId: string,
  entry: BacklinksSearchEntry,
  result: T,
  links?: L[],
  linksTotal?: number,
): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    cost: entry.cost ?? null,
    result: toJson(result),
    links: toNullableJson(links),
    linksTotal: linksTotal ?? null,
  };
  await prisma.backlinksSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getBacklinksResult<T>(userId: string, id: string): Promise<T | null> {
  const row = await prisma.backlinksSearch.findFirst({ where: { id, userId }, select: { result: true } });
  return (row?.result as T | undefined) ?? null;
}

export async function getBacklinksLinks<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.backlinksSearch.findFirst({ where: { id, userId }, select: { links: true } });
  return (row?.links as T[] | null | undefined) ?? null;
}

// --- Competitors ---

export interface CompetitorsSearchEntry {
  id: string;
  ts: number;
  target: string;
  location: string;
  language: string;
  count: number;
  cost?: number;
}

export async function getCompetitorsHistory(userId: string): Promise<CompetitorsSearchEntry[]> {
  const rows = await prisma.competitorsSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, location: true, language: true, resultCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    location: r.location,
    language: r.language,
    count: r.resultCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveCompetitorsSearch<T>(userId: string, entry: CompetitorsSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    location: entry.location,
    language: entry.language,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.competitorsSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getCompetitorsResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.competitorsSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Rank Tracker ---
// NOTE: TrackedKeyword.id + RankCheck.keywordId are now string (cuid), not int.

export interface TrackedKeyword {
  id: string;
  keyword: string;
  domain: string;
  location: string;
  language: string;
  createdAt: number;
}

export interface RankCheck {
  id: string;
  keywordId: string;
  checkedAt: number;
  date: string;
  position: number | null;
  url: string | null;
  title: string | null;
  cost: number | null;
}

export async function getTrackedKeywords(userId: string): Promise<TrackedKeyword[]> {
  const rows = await prisma.trackedKeyword.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, keyword: true, domain: true, location: true, language: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    keyword: r.keyword,
    domain: r.domain,
    location: r.location,
    language: r.language,
    createdAt: r.createdAt.getTime(),
  }));
}

export async function addTrackedKeyword(
  userId: string,
  keyword: string,
  domain: string,
  location: string,
  language: string,
): Promise<string> {
  const k = keyword.trim();
  const d = domain.trim();
  const row = await prisma.trackedKeyword.upsert({
    where: {
      userId_keyword_domain_location_language: { userId, keyword: k, domain: d, location, language },
    },
    update: {},
    create: { userId, keyword: k, domain: d, location, language },
    select: { id: true },
  });
  return row.id;
}

export async function removeTrackedKeyword(userId: string, id: string): Promise<void> {
  await prisma.trackedKeyword.deleteMany({ where: { id, userId } });
}

export async function saveRankCheck(
  userId: string,
  keywordId: string,
  position: number | null,
  url: string | null,
  title: string | null,
  cost: number | null,
): Promise<void> {
  // Ownership check — prevents writes against a keyword that isn't ours.
  const kw = await prisma.trackedKeyword.findFirst({ where: { id: keywordId, userId }, select: { id: true } });
  if (!kw) return;

  const now = Date.now();
  const date = new Date(now).toISOString().split('T')[0];
  await prisma.rankCheck.upsert({
    where: { keywordId_date: { keywordId, date } },
    update: { checkedAt: toBigInt(now), position, url, title, cost },
    create: { keywordId, checkedAt: toBigInt(now), date, position, url, title, cost },
  });
}

export async function getRankHistory(userId: string, keywordId: string, days = 30): Promise<RankCheck[]> {
  const kw = await prisma.trackedKeyword.findFirst({ where: { id: keywordId, userId }, select: { id: true } });
  if (!kw) return [];

  const rows = await prisma.rankCheck.findMany({
    where: { keywordId },
    orderBy: { date: 'desc' },
    take: days,
    select: { id: true, keywordId: true, checkedAt: true, date: true, position: true, url: true, title: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    keywordId: r.keywordId,
    checkedAt: fromBigInt(r.checkedAt),
    date: r.date,
    position: r.position,
    url: r.url,
    title: r.title,
    cost: r.cost,
  }));
}

export async function getLatestRankCheck(userId: string, keywordId: string): Promise<RankCheck | null> {
  const kw = await prisma.trackedKeyword.findFirst({ where: { id: keywordId, userId }, select: { id: true } });
  if (!kw) return null;

  const r = await prisma.rankCheck.findFirst({
    where: { keywordId },
    orderBy: { date: 'desc' },
    select: { id: true, keywordId: true, checkedAt: true, date: true, position: true, url: true, title: true, cost: true },
  });
  if (!r) return null;
  return {
    id: r.id,
    keywordId: r.keywordId,
    checkedAt: fromBigInt(r.checkedAt),
    date: r.date,
    position: r.position,
    url: r.url,
    title: r.title,
    cost: r.cost,
  };
}

// --- Referring Domains ---

export interface RefDomainsSearchEntry {
  id: string;
  ts: number;
  target: string;
  cost?: number;
  total?: number;
}

export async function getRefDomainsHistory(userId: string): Promise<RefDomainsSearchEntry[]> {
  const rows = await prisma.refDomainsSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, cost: true, total: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    cost: r.cost ?? undefined,
    total: r.total ?? undefined,
  }));
}

export async function saveRefDomainsSearch<T>(userId: string, entry: RefDomainsSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    cost: entry.cost ?? null,
    total: entry.total ?? 0,
    items: toJson(items),
  };
  await prisma.refDomainsSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getRefDomainsResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.refDomainsSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Anchors ---

export interface AnchorsSearchEntry {
  id: string;
  ts: number;
  target: string;
  cost?: number;
  total?: number;
}

export async function getAnchorsHistory(userId: string): Promise<AnchorsSearchEntry[]> {
  const rows = await prisma.anchorsSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, cost: true, total: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    cost: r.cost ?? undefined,
    total: r.total ?? undefined,
  }));
}

export async function saveAnchorsSearch<T>(userId: string, entry: AnchorsSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    cost: entry.cost ?? null,
    total: entry.total ?? 0,
    items: toJson(items),
  };
  await prisma.anchorsSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getAnchorsResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.anchorsSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Historical Rank Overview ---

export interface HistRankSearchEntry {
  id: string;
  ts: number;
  target: string;
  location: string;
  language: string;
  cost?: number;
}

export async function getHistRankHistory(userId: string): Promise<HistRankSearchEntry[]> {
  const rows = await prisma.histRankSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target: true, location: true, language: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target: r.target,
    location: r.location,
    language: r.language,
    cost: r.cost ?? undefined,
  }));
}

export async function saveHistRankSearch<T>(userId: string, entry: HistRankSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target: entry.target,
    location: entry.location,
    language: entry.language,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.histRankSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getHistRankResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.histRankSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Domain Intersection ---

export interface DomainIntersectionSearchEntry {
  id: string;
  ts: number;
  target1: string;
  target2: string;
  location: string;
  language: string;
  count: number;
  totalCount: number;
  cost?: number;
}

export async function getDomainIntersectionHistory(userId: string): Promise<DomainIntersectionSearchEntry[]> {
  const rows = await prisma.domainIntersectionSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, target1: true, target2: true, location: true, language: true, resultCount: true, totalCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    target1: r.target1,
    target2: r.target2,
    location: r.location,
    language: r.language,
    count: r.resultCount,
    totalCount: r.totalCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveDomainIntersectionSearch<T>(
  userId: string,
  entry: DomainIntersectionSearchEntry,
  items: T[],
): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    target1: entry.target1,
    target2: entry.target2,
    location: entry.location,
    language: entry.language,
    resultCount: entry.count,
    totalCount: entry.totalCount,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.domainIntersectionSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getDomainIntersectionResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.domainIntersectionSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Keyword Difficulty ---

export interface KwDifficultySearchEntry {
  id: string;
  ts: number;
  keywords: string;
  location: string;
  language: string;
  count: number;
  cost?: number;
}

export async function getKwDifficultyHistory(userId: string): Promise<KwDifficultySearchEntry[]> {
  const rows = await prisma.kwDifficultySearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, keywords: true, location: true, language: true, resultCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keywords: r.keywords as unknown as string,
    location: r.location,
    language: r.language,
    count: r.resultCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveKwDifficultySearch<T>(userId: string, entry: KwDifficultySearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keywords: toJson(entry.keywords),
    location: entry.location,
    language: entry.language,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.kwDifficultySearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getKwDifficultyResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.kwDifficultySearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Related Keywords ---

export interface RelatedKwSearchEntry {
  id: string;
  ts: number;
  keyword: string;
  location: string;
  language: string;
  depth: number;
  count: number;
  cost?: number;
}

export async function getRelatedKwHistory(userId: string): Promise<RelatedKwSearchEntry[]> {
  const rows = await prisma.relatedKwSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, keyword: true, location: true, language: true, depth: true, resultCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keyword: r.keyword,
    location: r.location,
    language: r.language,
    depth: r.depth,
    count: r.resultCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveRelatedKwSearch<T>(userId: string, entry: RelatedKwSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keyword: entry.keyword,
    location: entry.location,
    language: entry.language,
    depth: entry.depth,
    resultCount: entry.count,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.relatedKwSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getRelatedKwResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.relatedKwSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Grid Search ---

export interface GridSearchEntry {
  id: string;
  ts: number;
  keyword: string;
  target: string;
  center: string;
  grid_size: number;
  spacing_km: number;
  language: string;
  cost?: number;
}

export interface GridLocalItem {
  rank_group: number;
  title: string;
  domain?: string;
  rating_value?: number;
  rating_votes?: number;
  is_target: boolean;
}

export interface GridPoint {
  row: number;
  col: number;
  lat?: number;
  lng?: number;
  rank: number | null;
  items?: GridLocalItem[];
}

export async function getGridHistory(userId: string): Promise<GridSearchEntry[]> {
  const rows = await prisma.gridSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 20,
    select: { id: true, ts: true, keyword: true, target: true, center: true, gridSize: true, spacingKm: true, language: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    keyword: r.keyword,
    target: r.target,
    center: r.center,
    grid_size: r.gridSize,
    spacing_km: r.spacingKm,
    language: r.language,
    cost: r.cost ?? undefined,
  }));
}

export async function saveGridSearch(userId: string, entry: GridSearchEntry, results: GridPoint[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    keyword: entry.keyword,
    target: entry.target,
    center: entry.center,
    gridSize: entry.grid_size,
    spacingKm: entry.spacing_km,
    language: entry.language,
    cost: entry.cost ?? null,
    results: toJson(results),
  };
  await prisma.gridSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getGridResults(userId: string, id: string): Promise<GridPoint[] | null> {
  const row = await prisma.gridSearch.findFirst({ where: { id, userId }, select: { results: true } });
  return (row?.results as GridPoint[] | undefined) ?? null;
}

// --- Instant Pages ---

export interface InstantPageEntry {
  id: string;
  ts: number;
  url: string;
  cost?: number;
}

export async function getInstantPageHistory(userId: string): Promise<InstantPageEntry[]> {
  const rows = await prisma.instantPageSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, url: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    url: r.url,
    cost: r.cost ?? undefined,
  }));
}

export async function saveInstantPageResult<T>(userId: string, entry: InstantPageEntry, result: T): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    url: entry.url,
    cost: entry.cost ?? null,
    result: toJson(result),
  };
  await prisma.instantPageSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getInstantPageResult<T>(userId: string, id: string): Promise<T | null> {
  const row = await prisma.instantPageSearch.findFirst({ where: { id, userId }, select: { result: true } });
  return (row?.result as T | undefined) ?? null;
}

// --- Reddit ---

export interface RedditSearchEntry {
  id: string;
  ts: number;
  targets: string;
  count: number;
  cost?: number;
}

export async function getRedditHistory(userId: string): Promise<RedditSearchEntry[]> {
  const rows = await prisma.redditSearch.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, targets: true, resultCount: true, cost: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    targets: r.targets as unknown as string,
    count: r.resultCount,
    cost: r.cost ?? undefined,
  }));
}

export async function saveRedditSearch<T>(userId: string, entry: RedditSearchEntry, items: T[]): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(entry.ts),
    targets: toJson(entry.targets),
    resultCount: entry.count,
    cost: entry.cost ?? null,
    items: toJson(items),
  };
  await prisma.redditSearch.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });
}

export async function getRedditResults<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.redditSearch.findFirst({ where: { id, userId }, select: { items: true } });
  return (row?.items as T[] | undefined) ?? null;
}

// --- Google Reviews ---

export interface ReviewsTask {
  id: string;
  ts: number;
  business: string;
  location: string;
  language: string;
  depth: number;
  sortBy: string;
  status: 'pending' | 'ready' | 'error';
  cost?: number;
  resultCount?: number;
}

export async function saveReviewsTask(
  userId: string,
  id: string,
  business: string,
  location: string,
  language: string,
  depth: number,
  sortBy: string,
  cost?: number,
): Promise<void> {
  const data = {
    userId,
    ts: toBigInt(Date.now()),
    business,
    location,
    language,
    depth,
    sortBy,
    status: 'pending',
    cost: cost ?? null,
  };
  await prisma.reviewsTask.upsert({
    where: { id },
    update: data,
    create: { id, ...data },
  });
}

export async function getReviewsTasks(userId: string): Promise<ReviewsTask[]> {
  const rows = await prisma.reviewsTask.findMany({
    where: { userId },
    orderBy: { ts: 'desc' },
    take: 30,
    select: { id: true, ts: true, business: true, location: true, language: true, depth: true, sortBy: true, status: true, cost: true, resultCount: true },
  });
  return rows.map((r) => ({
    id: r.id,
    ts: fromBigInt(r.ts),
    business: r.business,
    location: r.location,
    language: r.language,
    depth: r.depth,
    sortBy: r.sortBy,
    status: r.status as ReviewsTask['status'],
    cost: r.cost ?? undefined,
    resultCount: r.resultCount ?? undefined,
  }));
}

export async function updateReviewsTask(
  userId: string,
  id: string,
  status: ReviewsTask['status'],
  items: unknown[],
  cost?: number,
  resultCount?: number,
): Promise<void> {
  await prisma.reviewsTask.updateMany({
    where: { id, userId },
    data: {
      status,
      result: toJson(items),
      cost: cost ?? null,
      resultCount: resultCount ?? items.length,
    },
  });
}

export async function getReviewsTaskResult<T>(userId: string, id: string): Promise<T[] | null> {
  const row = await prisma.reviewsTask.findFirst({ where: { id, userId }, select: { result: true } });
  return (row?.result as T[] | undefined) ?? null;
}
