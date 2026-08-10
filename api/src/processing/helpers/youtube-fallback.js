import { fetch } from "undici";
import { YtDlp } from "ytdlp-nodejs";

// Fallback downloader for youtube, used when the innertube player
// gets bot-blocked (youtube.login). Uses the cnv.cx/y2mate API for the
// download URL and yt-dlp for metadata (duration, width, height, thumbnail).

const BASE_IFRAME = "https://frame.y2meta-uk.com";
const BASE_API = "https://cnv.cx";

const BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Accept-Language": "ru,en-US;q=0.9,en;q=0.8,uz;q=0.7",
};

const MAX_RETRIES = 3;
const RETRY_CODES = new Set([429, 500, 502, 503, 504]);

// ── videoId extraction ────────────────────────────────────────────────

const YT_RE = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;

function extractVideoId(urlOrId) {
    urlOrId = urlOrId.trim();

    const m = YT_RE.exec(urlOrId);
    if (m) return m[1];

    const vMatch = /[?&]v=([A-Za-z0-9_-]{11})/.exec(urlOrId);
    if (vMatch) return vMatch[1];

    if (VALID_ID.test(urlOrId)) return urlOrId;

    const candidate = urlOrId.slice(0, 11);
    if (VALID_ID.test(candidate)) return candidate;

    throw new Error(`Could not extract videoId from: ${urlOrId}`);
}

// ── retry wrapper ─────────────────────────────────────────────────────

async function requestWithRetry(method, url, { maxRetries = MAX_RETRIES, ...opts } = {}) {
    let delay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const resp = await fetch(url, { method, ...opts });

        if (resp.status === 200) {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('json')) return await resp.json();
            return await resp.text();
        }

        if (RETRY_CODES.has(resp.status) && attempt < maxRetries) {
            const retryAfter = resp.headers.get('retry-after');
            const wait = retryAfter && /^\d+$/.test(retryAfter)
                ? Number(retryAfter) * 1000
                : delay;

            await new Promise(r => setTimeout(r, wait));
            delay = Math.min(delay * 2, 30000);
            continue;
        }

        const body = await resp.text();
        throw new Error(`Error ${resp.status} on ${url}: ${body.slice(0, 200)}`);
    }

    throw new Error(`Could not get a response from ${url}`);
}

const unescapeHtml = (str) => str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const sanitizeFilename = (name) => name.replace(/[<>:"/\\|?*]/g, '_');

// ── yt-dlp metadata ──────────────────────────────────────────────────

const ytdlp = new YtDlp();

async function getMetadata(videoId, urlOrId) {
    const link = urlOrId.includes("youtube.com") || urlOrId.includes("youtu.be")
        ? urlOrId
        : `https://youtu.be/${videoId}`;

    const info = await ytdlp.getInfoAsync(link);
    return {
        title: info.title || videoId,
        author: info.channel || info.uploader || undefined,
        duration: info.duration || undefined,
        width: info.width || undefined,
        height: info.height || undefined,
        thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    };
}

// ── cnv.cx converter ─────────────────────────────────────────────────

async function getDownloadUrlFromCnv(videoId, link, { fmt, quality }) {
    // 1. visit the iframe to establish a cloudflare session
    await requestWithRetry("GET", `${BASE_IFRAME}/lolindex.php?videoId=${videoId}`, {
        headers: {
            ...BASE_HEADERS,
            "Accept": "text/html,application/xhtml+xml",
            "Referer": "https://y2mate.mobi/",
            "Origin": "https://y2mate.mobi",
        },
    });

    // 2. grab the api key
    const keyData = await requestWithRetry("GET", `${BASE_API}/v2/sanity/key?id=${videoId}`, {
        headers: {
            ...BASE_HEADERS,
            "Accept": "*/*",
            "Referer": `${BASE_IFRAME}/`,
            "Origin": BASE_IFRAME,
        },
    });

    if (!keyData || typeof keyData?.key !== 'string') {
        throw new Error(`Could not get api key: ${JSON.stringify(keyData)}`);
    }

    // 3. request the converter
    const convData = new URLSearchParams({
        link,
        format: fmt,
        audioBitrate: "128",
        videoQuality: quality,
        filenameStyle: "pretty",
        vCodec: "h264",
    });

    const result = await requestWithRetry("POST", `${BASE_API}/v2/converter`, {
        body: convData,
        headers: {
            ...BASE_HEADERS,
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": `${BASE_IFRAME}/`,
            "Origin": BASE_IFRAME,
            "key": keyData.key,
        },
    });

    if (!result || typeof result !== 'object') {
        throw new Error(`Unexpected converter response: ${JSON.stringify(result)}`);
    }

    const tunnelUrl = result.url;
    if (!tunnelUrl) {
        throw new Error(`API did not return a url: ${result.status} — ${result.msg || ''}`);
    }

    return {
        url: unescapeHtml(tunnelUrl),
        filename: sanitizeFilename(result.filename || `${videoId}.${fmt}`),
    };
}

// ── main entry ────────────────────────────────────────────────────────

export async function getDownloadUrl(urlOrId, { fmt = "mp4", quality = "720", fetchFn = fetch } = {}) {
    const videoId = extractVideoId(urlOrId);

    const link = (urlOrId.includes("youtube.com") || urlOrId.includes("youtu.be"))
        ? urlOrId
        : `https://youtu.be/${videoId}`;

    // run cnv.cx conversion and yt-dlp metadata fetch in parallel
    const [download, meta] = await Promise.all([
        getDownloadUrlFromCnv(videoId, link, { fmt, quality }),
        getMetadata(videoId, urlOrId).catch(() => ({})),
    ]);

    return {
        url: download.url,
        filename: download.filename,
        title: meta.title || videoId,
        author: meta.author,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    };
}
