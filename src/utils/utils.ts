import { getLogger } from "@logtape/logtape";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = getLogger(["Dbg", "App", "Utils"]);

/**
 * Retrieve video id from url or string
 * @param videoId video url or video id
 */
export function retrieveVideoId(videoId: string) {
    if (videoId.length === 11) {
        return videoId;
    }

    const regex =
        // eslint-disable-next-line no-useless-escape
        /(?:youtu\.be\/|youtube\.com\/(?:shorts|embed|v|watch\?v=|ytscreeningroom\?v=)|youtube\.com\/(?:.*?[?&]v=))([^"&?\/\s]{11})/i;
    const matchId = videoId.match(regex);

    if (matchId && matchId.length) {
        return matchId[1];
    }

    throw new YoutubeTranscriptError(
        "Impossible to retrieve Youtube video ID."
    );
}

export class YoutubeTranscriptError extends Error {
    constructor(message: string) {
        super(`[YoutubeTranscript] 🚨 ${message}`);
    }
}

export function extractYamlContent(response: string): string {
    if (response.includes("```yaml")) {
        const parts = response.split("```yaml");
        if (parts.length > 1) {
            const yamlPart = parts[1].split("```");
            if (yamlPart.length > 0) {
                return yamlPart[0].trim();
            }
        }
    }
    return response;
}

export const makeId = (length: number) => {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < length; i += 1) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

type Bullet = [string, string]; // Tuple: [bold_text, regular_text

// Define the structure for a section
interface Section {
    title: string;
    questions: Bullet[];
}

export type { Bullet, Section };

export interface ProcessedTopicResult {
    title: string;
    rephrasedTitle: string;
    questions: {
        original: string;
        rephrased: string;
        answer: string;
    }[];
}

export async function createFile(fileContent: string, filePath: string) {
    try {
        const htmlFile = Bun.file(filePath);
        if (!(await htmlFile.exists())) {
            await Bun.write(filePath, fileContent);
            logger.debug`Data written to new file: ${filePath}`;
        } else {
            await Bun.write(htmlFile, fileContent);
        }
    } catch (error) {
        logger.error`Error parsing into file. ${error}`;
    }
}
