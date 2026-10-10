// Type definitions for @three-ws/intel

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: string;
	retryAfter?: number;
	body: unknown;
}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;

export interface IntelClientOptions {
	baseUrl?: string;
	fetch?: typeof fetch;
	/** Bearer token attached as Authorization on every call. */
	apiKey?: string;
	headers?: Record<string, string>;
}

// ── sentiment ────────────────────────────────────────────────────────────────

export interface SentimentOptions {
	/** Max pump.fun comments to fetch + score (1–200). Default 100. */
	limit?: number;
	/** Up to 200 extra snippets (≤2000 chars each) to score alongside. */
	extraTexts?: string[];
	signal?: AbortSignal;
}

/** A deterministic lexicon score. `score` runs -1…1; the `*Pct` fields sum to 100. */
export interface Score {
	score: number;
	posPct: number;
	negPct: number;
	neuPct: number;
	count: number;
	examples: { pos: string[]; neg: string[] };
}

/** The degraded state a source returns when it could not be fetched. */
export interface ScoreError {
	error: string;
	count: number;
}

export interface SentimentPulse {
	ok: boolean;
	token: string | null;
	overall: Score | null;
	breakdown: {
		pumpfun: Score | ScoreError | null;
		extra: Score | null;
	};
	sources: {
		pumpfun: string | null;
		pumpfunCount: number | null;
		extraCount: number | null;
	};
	fetchedAt: string | null;
	raw: unknown;
}

// ── aixbt intel + projects ─────────────────────────────────────────────────────

export interface IntelQuery {
	/** Items to return (1–100). Default 20. */
	limit?: number;
	/** Filter to one aixbt intel category. */
	category?: string;
	/** Filter to a chain, e.g. `solana`, `base`, `ethereum`. */
	chain?: string;
	signal?: AbortSignal;
}

export interface IntelItem {
	category: string | null;
	description: string | null;
	detectedAt: string | null;
	reinforcedAt: string | null;
	observations: number | null;
	officialSource: boolean;
	project: string | null;
	ticker: string | null;
	source: string | null;
	/** snake_case mirrors the README documents. */
	detected_at: string | null;
	reinforced_at: string | null;
	official_source: boolean;
}

export interface IntelFeed {
	intel: IntelItem[];
	pagination: unknown | null;
	raw: unknown;
}

export interface ProjectsQuery {
	/** Projects to return (1–100). Default 20. */
	limit?: number;
	/** Page of the ranked list (1–100). Default 1. */
	page?: number;
	/** Comma-separated names/tickers to filter to. */
	names?: string;
	/** Filter to a chain. */
	chain?: string;
	signal?: AbortSignal;
}

export interface ProjectMarket {
	priceUsd: number | null;
	marketCap: number | null;
	volume24h: number | null;
	change24h: number | null;
	price_usd: number | null;
	market_cap: number | null;
	volume_24h: number | null;
	change_24h: number | null;
}

export interface Project {
	id: string | null;
	name: string | null;
	ticker: string | null;
	xHandle: string | null;
	x_handle: string | null;
	address: string | null;
	chain: string | null;
	scores: { spiking: number | null; climbing: number | null; active: number | null };
	trajectory: string | null;
	market: ProjectMarket;
	intel: IntelItem[];
	categories: string[];
	raw: unknown;
}

export interface ProjectScan {
	projects: Project[];
	pagination: unknown | null;
	raw: unknown;
}

// ── snapshot ────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
	signal?: AbortSignal;
}

export interface TokenSnapshot {
	token: string;
	priceUsd: number | null;
	priceSource: 'jupiter' | 'dexscreener' | null;
	price: {
		usdPrice?: number | null;
		priceChange24hPct?: number | null;
		liquidityUsd?: number | null;
		decimals?: number | null;
		blockId?: number | null;
		error?: string;
	} | null;
	volume24h: Record<string, unknown> | null;
	meta: Record<string, unknown> | null;
	holders: {
		topHolderCount?: number;
		topHolders?: Array<{ address: string; uiAmount: number | null; amount: string; decimals: number }>;
		error?: string;
	} | null;
	helius: Record<string, unknown> | null;
	image: string | null;
	sources: Record<string, unknown> | null;
	fetchedAt: string | null;
	raw: unknown;
}

// ── client + default functions ─────────────────────────────────────────────────

export interface IntelClient {
	sentiment(mint: string, opts?: SentimentOptions): Promise<SentimentPulse>;
	intel(query?: IntelQuery): Promise<IntelFeed>;
	projects(query?: ProjectsQuery): Promise<ProjectScan>;
	snapshot(mint: string, opts?: SnapshotOptions): Promise<TokenSnapshot>;
}

export declare function createIntel(options?: IntelClientOptions): IntelClient;
export declare function sentiment(mint: string, opts?: SentimentOptions): Promise<SentimentPulse>;
export declare function intel(query?: IntelQuery): Promise<IntelFeed>;
export declare function projects(query?: ProjectsQuery): Promise<ProjectScan>;
export declare function snapshot(mint: string, opts?: SnapshotOptions): Promise<TokenSnapshot>;
