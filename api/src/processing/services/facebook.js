import { genericUserAgent } from "../../config.js";

const headers = {
    'User-Agent': genericUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
}

const resolveUrl = (url, dispatcher) => {
    return fetch(url, { headers, dispatcher })
        .then(r => {
            if (r.headers.get('location')) {
                return decodeURIComponent(r.headers.get('location'));
            }
            if (r.headers.get('link')) {
                const linkMatch = r.headers.get('link').match(/<(.*?)\/>/);
                return decodeURIComponent(linkMatch[1]);
            }
            return false;
        })
        .catch(() => false);
}

export default async function({ id, shareType, shortLink, dispatcher }) {
    let url = `https://www.facebook.com/reel/${id}`;

    if (shareType) url = `https://www.facebook.com/share/${shareType}/${id}`;
    if (shortLink) url = await resolveUrl(`https://fb.watch/${shortLink}`, dispatcher);

    const html = await fetch(url, { headers, dispatcher })
        .then(r => r.text())
        .catch(() => false);

    if (!html && shortLink) return { error: "fetch.short_link" }
    if (!html) return { error: "fetch.fail" };

    const urls = [];
    const hd = html.match('"browser_native_hd_url":(".*?")');
    const sd = html.match('"browser_native_sd_url":(".*?")');

    if (hd?.[1]) urls.push(JSON.parse(hd[1]));
    if (sd?.[1]) urls.push(JSON.parse(sd[1]));

    if (!urls.length) {
        return { error: "fetch.empty" };
    }

    const baseFilename = `facebook_${id || shortLink}`;

    const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
    const ogWidth = html.match(/property="og:video:width"\s+content="(\d+)"/);
    const ogHeight = html.match(/property="og:video:height"\s+content="(\d+)"/);
    const ogDuration = html.match(/property="og:video:duration"\s+content="(\d+)"/);

    const unescape = (s) => s ? s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : undefined;

    return {
        urls: urls[0],
        filename: `${baseFilename}.mp4`,
        audioFilename: `${baseFilename}_audio`,
        thumbnail: unescape(ogImage?.[1]),
        width: ogWidth ? Number(ogWidth[1]) : undefined,
        height: ogHeight ? Number(ogHeight[1]) : undefined,
        duration: ogDuration ? Number(ogDuration[1]) : undefined,
    };
}
