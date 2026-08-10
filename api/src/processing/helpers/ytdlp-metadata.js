import { YtDlp } from "ytdlp-nodejs";

// Global metadata helper — uses yt-dlp to fill in missing
// thumbnail/width/height/duration for ANY service.

const ytdlp = new YtDlp();

/**
 * @param {string} url — original media URL
 * @param {object} existing — already-known metadata from the service
 * @returns {Promise<{thumbnail?: string, width?: number, height?: number, duration?: number}>}
 */
export async function enrichMetadata(url, existing = {}) {
    // skip if all fields are already present
    if (existing.thumbnail && existing.width && existing.height && existing.duration) {
        return existing;
    }

    try {
        const info = await ytdlp.getInfoAsync(url, {
            skipDownload: true,
        });

        return {
            thumbnail: existing.thumbnail || info.thumbnail || undefined,
            width: existing.width || info.width || undefined,
            height: existing.height || info.height || undefined,
            duration: existing.duration || info.duration || undefined,
        };
    } catch {
        // yt-dlp failed (unsupported site, network, bot-block) — return existing
        return existing;
    }
}
