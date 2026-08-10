import { fetch } from "undici";

export default async function({ id, url }) {
    const likeeUrl = url?.toString() || `https://likee.video/${id}`;

    const resp = await fetch("https://likeedownloader.com/process", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138",
        },
        body: new URLSearchParams({ id: likeeUrl, locale: "en" }),
    });

    if (resp.status !== 200) return { error: "fetch.fail" };

    const json = await resp.json();
    const html = json.template;

    if (!html) return { error: "fetch.empty" };

    // check for API error (invalid/deleted video)
    if (html.includes("class='error'") || html.includes('class="error"')) {
        return { error: "content.video.unavailable" };
    }

    // parse the template HTML — class uses single quotes, href uses double quotes
    const linkMatch = html.match(/without_watermark[\s\S]*?href=["']([^"']+)["']/);
    if (!linkMatch?.[1]) return { error: "fetch.empty" };

    const videoUrl = linkMatch[1];

    return {
        urls: videoUrl,
        filename: `likee_${id}.mp4`,
        audioFilename: `likee_${id}_audio`,
    };
}
