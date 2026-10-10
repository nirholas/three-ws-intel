// @three-ws/intel — token sentiment + market intelligence in one import.
//
// Four reads over the three.ws intelligence surface, each a thin client over a
// real endpoint:
//   · sentiment(mint)  → POST /api/social/sentiment-pulse   (public, key-free)
//   · intel(query)     → GET  /api/aixbt/intel              (aixbt bridge)
//   · projects(query)  → GET  /api/aixbt/projects           (aixbt bridge)
//   · snapshot(mint)   → POST /api/mcp  (tools/call pump_snapshot, x402-paid)
//
// The aixbt and snapshot lanes are payment-gated: the http core throws a
// PaymentRequiredError on HTTP 402 carrying the x402 challenge, so pass a
// payment-aware `fetch` (e.g. @three-ws/x402-fetch) to auto-settle. See
// README.md for the full reference.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';

// Base58 Solana mint — mirrors the SOLANA_MINT_RE the sentiment endpoint
// validates against, so we reject bad input before the network call.
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// pump_snapshot is hosted by the three.ws MCP server at the JSON-RPC transport;
// snapshot() reaches it with a single tools/call so the paid lane settles over
// the same x402 / HTTP 402 path every other paid SDK uses.
const MCP_PATH = '/api/mcp';
const SNAPSHOT_TOOL = 'pump_snapshot';

/**
 * Create an Intel client bound to a base URL, fetch, and optional auth.
 * For most callers the default exports (`sentiment()`, `intel()`, …) are
 * enough; use this to reuse configuration — a payment-aware fetch for the paid
 * lanes, a custom origin, or a bearer token — across many calls.
 *
 * @param {IntelClientOptions} [options]
 */
export function createIntel(options = {}) {
	const request = createHttp(options);

	// ── sentiment ─────────────────────────────────────────────────────────────

	/** Real-time sentiment pulse for a Solana token. Public — no key required. */
	async function sentiment(mint, opts = {}) {
		const token = String(mint || '').trim();
		if (!SOLANA_MINT_RE.test(token)) {
			throw new ThreeWsError('sentiment() needs a base58 Solana mint pubkey.', { code: 'invalid_input' });
		}
		const limit = opts.limit;
		if (limit != null && !(Number.isInteger(limit) && limit >= 1 && limit <= 200)) {
			throw new ThreeWsError('limit must be an integer between 1 and 200.', { code: 'invalid_input' });
		}
		const extraTexts = opts.extraTexts;
		if (extraTexts != null) {
			if (!Array.isArray(extraTexts) || extraTexts.length > 200) {
				throw new ThreeWsError('extraTexts must be an array of at most 200 strings.', { code: 'invalid_input' });
			}
			for (const t of extraTexts) {
				if (typeof t !== 'string' || t.length > 2000) {
					throw new ThreeWsError('each extraTexts entry must be a string ≤ 2000 chars.', { code: 'invalid_input' });
				}
			}
		}

		const body = prune({ token, limit, extraTexts });
		const res = await request('/api/social/sentiment-pulse', {
			method: 'POST',
			body,
			signal: opts.signal,
		});
		return shapeSentiment(res);
	}

	// ── aixbt narrative + momentum ──────────────────────────────────────────────

	/** aixbt narrative intelligence feed. Paid via the aixbt bridge ($0.01). */
	async function intel(query = {}) {
		const limit = normLimit(query.limit, 100, 'limit');
		const res = await request('/api/aixbt/intel', {
			query: prune({ limit, category: query.category, chain: query.chain }),
			signal: query.signal,
		});
		return shapeIntelFeed(res);
	}

	/** aixbt momentum scan — projects ranked by spiking / climbing / active ($0.01). */
	async function projects(query = {}) {
		const limit = normLimit(query.limit, 100, 'limit');
		const page = normLimit(query.page, 100, 'page');
		const res = await request('/api/aixbt/projects', {
			query: prune({ limit, page, names: query.names, chain: query.chain }),
			signal: query.signal,
		});
		return shapeProjectScan(res);
	}

	// ── snapshot ────────────────────────────────────────────────────────────────

	/** Live market snapshot for any Solana SPL or pump.fun token. Paid ($0.005). */
	async function snapshot(mint, opts = {}) {
		const token = String(mint || '').trim();
		if (!SOLANA_MINT_RE.test(token)) {
			throw new ThreeWsError('snapshot() needs a base58 Solana mint pubkey.', { code: 'invalid_mint' });
		}
		// One JSON-RPC tools/call. A missing payment surfaces as HTTP 402 →
		// PaymentRequiredError from the http core; tool-level faults come back as a
		// JSON-RPC error object we map to ThreeWsError below.
		const res = await request(MCP_PATH, {
			method: 'POST',
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: SNAPSHOT_TOOL, arguments: { token } },
			},
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			signal: opts.signal,
		});
		return shapeSnapshot(unwrapToolResult(res), token);
	}

	return { sentiment, intel, projects, snapshot };
}

// A module-level default client for the zero-config path: `import { sentiment }`.
let shared = null;
function defaultClient() {
	return (shared ||= createIntel());
}

/** Real-time sentiment pulse for a Solana token. Public — no key required. */
export function sentiment(mint, opts) {
	return defaultClient().sentiment(mint, opts);
}
/** aixbt narrative intelligence feed. Paid via the aixbt bridge ($0.01). */
export function intel(query) {
	return defaultClient().intel(query);
}
/** aixbt momentum scan — projects ranked by spiking / climbing / active ($0.01). */
export function projects(query) {
	return defaultClient().projects(query);
}
/** Live market snapshot for any Solana SPL or pump.fun token. Paid ($0.005). */
export function snapshot(mint, opts) {
	return defaultClient().snapshot(mint, opts);
}

// ── shapers: keep the endpoint's stable fields, expose camelCase, hold `.raw` ──

function shapeSentiment(res) {
	if (!res || typeof res !== 'object') {
		throw new ThreeWsError('Unexpected empty response from /api/social/sentiment-pulse.', { code: 'bad_response' });
	}
	const sources = res.sources || {};
	return {
		ok: res.ok === true,
		token: res.token ?? null,
		overall: shapeScore(res.overall),
		breakdown: {
			pumpfun: shapeScore(res.breakdown?.pumpfun),
			extra: shapeScore(res.breakdown?.extra),
		},
		sources: {
			pumpfun: sources.pumpfun ?? null,
			pumpfunCount: numOrNull(sources.pumpfunCount),
			extraCount: numOrNull(sources.extraCount),
		},
		fetchedAt: res.fetchedAt ?? null,
		raw: res,
	};
}

// A Score, or the { error, count: 0 } degraded state pump.fun returns on failure.
function shapeScore(s) {
	if (!s || typeof s !== 'object') return null;
	if (s.error != null) {
		return { error: String(s.error), count: numOrNull(s.count) ?? 0 };
	}
	return {
		score: numOrNull(s.score) ?? 0,
		posPct: numOrNull(s.posPct) ?? 0,
		negPct: numOrNull(s.negPct) ?? 0,
		neuPct: numOrNull(s.neuPct) ?? 0,
		count: numOrNull(s.count) ?? 0,
		examples: {
			pos: Array.isArray(s.examples?.pos) ? s.examples.pos : [],
			neg: Array.isArray(s.examples?.neg) ? s.examples.neg : [],
		},
	};
}

// /api/aixbt/intel already returns the lean { intel, pagination } shape — the
// items are bridge-normalized snake_case, which the README documents verbatim.
function shapeIntelFeed(res) {
	const list = Array.isArray(res?.intel) ? res.intel : [];
	return {
		intel: list.map(shapeIntelItem).filter(Boolean),
		pagination: res?.pagination ?? null,
		raw: res,
	};
}

function shapeIntelItem(i) {
	if (!i || typeof i !== 'object') return null;
	return {
		category: i.category ?? null,
		description: i.description ?? null,
		detectedAt: i.detected_at ?? null,
		reinforcedAt: i.reinforced_at ?? null,
		observations: numOrNull(i.observations),
		officialSource: Boolean(i.official_source),
		project: i.project ?? null,
		ticker: i.ticker ?? null,
		source: i.source ?? null,
		// snake_case fields the README enumerates, preserved for callers that want them.
		detected_at: i.detected_at ?? null,
		reinforced_at: i.reinforced_at ?? null,
		official_source: Boolean(i.official_source),
	};
}

function shapeProjectScan(res) {
	const list = Array.isArray(res?.projects) ? res.projects : [];
	return {
		projects: list.map(shapeProject).filter(Boolean),
		pagination: res?.pagination ?? null,
		raw: res,
	};
}

function shapeProject(p) {
	if (!p || typeof p !== 'object') return null;
	const m = p.market || {};
	const s = p.scores || {};
	return {
		id: p.id ?? null,
		name: p.name ?? null,
		ticker: p.ticker ?? null,
		xHandle: p.x_handle ?? null,
		address: p.address ?? null,
		chain: p.chain ?? null,
		scores: {
			spiking: numOrNull(s.spiking),
			climbing: numOrNull(s.climbing),
			active: numOrNull(s.active),
		},
		trajectory: p.trajectory ?? null,
		market: {
			priceUsd: numOrNull(m.price_usd),
			marketCap: numOrNull(m.market_cap),
			volume24h: numOrNull(m.volume_24h),
			change24h: numOrNull(m.change_24h),
			// snake_case mirror, matching the README field table.
			price_usd: numOrNull(m.price_usd),
			market_cap: numOrNull(m.market_cap),
			volume_24h: numOrNull(m.volume_24h),
			change_24h: numOrNull(m.change_24h),
		},
		intel: Array.isArray(p.intel) ? p.intel.map(shapeIntelItem).filter(Boolean) : [],
		categories: Array.isArray(p.categories) ? p.categories : [],
		// README documents x_handle on the Project — keep it reachable too.
		x_handle: p.x_handle ?? null,
		raw: p,
	};
}

// The pump_snapshot tool already returns camelCase; we pass it through with a
// stable surface and a `.raw` escape hatch so the README's field names hold.
function shapeSnapshot(d, token) {
	if (!d || typeof d !== 'object') {
		throw new ThreeWsError('Unexpected empty snapshot result.', { code: 'bad_response' });
	}
	return {
		token: d.token ?? token,
		priceUsd: d.priceUsd ?? null,
		priceSource: d.priceSource ?? null,
		price: d.price ?? null,
		volume24h: d.volume24h ?? null,
		meta: d.meta ?? null,
		holders: d.holders ?? null,
		helius: d.helius ?? null,
		image: d.image ?? null,
		sources: d.sources ?? null,
		fetchedAt: d.fetchedAt ?? null,
		raw: d,
	};
}

// Unwrap a JSON-RPC tools/call response into the tool's structuredContent. The
// http core has already turned HTTP 402 into a PaymentRequiredError, so here we
// only handle the 200-with-JSON-RPC-error and tool isError cases.
function unwrapToolResult(res) {
	if (!res || typeof res !== 'object') {
		throw new ThreeWsError('Unexpected empty response from the MCP endpoint.', { code: 'bad_response' });
	}
	if (res.error) {
		const e = res.error;
		throw new ThreeWsError(e.message || 'snapshot tool call failed', {
			code: mcpErrorCode(e.code),
			body: res,
		});
	}
	const result = res.result || {};
	if (result.isError) {
		const text = result.content?.find?.((c) => c?.type === 'text')?.text;
		const structured = result.structuredContent || {};
		throw new ThreeWsError(structured.message || text || 'snapshot failed', {
			code: structured.error || 'snapshot_failed',
			body: result,
		});
	}
	return result.structuredContent ?? result;
}

// Map the JSON-RPC -32xxx numbers the MCP server uses to readable codes.
function mcpErrorCode(code) {
	if (code === -32602) return 'invalid_mint';
	if (code === -32002) return 'insufficient_scope';
	if (code === -32601) return 'method_not_found';
	return 'mcp_error';
}

// ── small helpers ────────────────────────────────────────────────────────────

// limit/page: clamp-validate to [1, max] integers, leaving `undefined` so the
// endpoint applies its own default.
function normLimit(v, max, label) {
	if (v == null) return undefined;
	if (!(Number.isInteger(v) && v >= 1 && v <= max)) {
		throw new ThreeWsError(`${label} must be an integer between 1 and ${max}.`, { code: 'invalid_input' });
	}
	return v;
}

function numOrNull(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function prune(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		out[k] = v;
	}
	return out;
}
