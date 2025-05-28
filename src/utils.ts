import {
    GoogleGenerativeAI,
    type BatchEmbedContentsRequest,
    type ContentEmbedding,
} from "@google/generative-ai";
import { getLogger } from "@logtape/logtape";
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

export async function callLLM(prompt: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(Bun.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: Bun.env.GEMINI_MODEL! });
    const result = await model.generateContent(prompt);
    // logger.debug`LLM result: ${result.response.text()}`;
    logger.debug`LLM result Metadata: ${result.response.usageMetadata}`;
    return result.response.text();
}

export async function createEmbeddings(prompt: string): Promise<number[]> {
    const genAI = new GoogleGenerativeAI(Bun.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: Bun.env.GEMINI_MODEL! });
    const result = await model.embedContent(prompt);
    logger.debug`LLM embedings: ${result.embedding.values}`;
    logger.debug`LLM result Metadata`;
    return result.embedding.values;
}

export async function createBatchEmbeddings(
    contents: string[]
): Promise<ContentEmbedding[]> {
    try {
        const genAI = new GoogleGenerativeAI(Bun.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({
            model: Bun.env.GEMINI_EMBED_MODEL!,
        });

        let embedValues: ContentEmbedding[] = [];

        const myBatchGenerator = batchGenerator(contents, 100);

        for (const batch of myBatchGenerator) {
            await Bun.sleep(5000);
            console.log("Processing batch:", batch.length);
            const batchEmbedContentRequest: BatchEmbedContentsRequest = {
                requests: batch.map((text) => ({
                    content: { parts: [{ text }], role: "user" },
                })),
            };
            // logger.debug`Batch request: ${batchEmbedContentRequest.requests}`;

            const result = await model.batchEmbedContents(
                batchEmbedContentRequest
            );

            logger.debug`Embed result: ${result.embeddings.length}`;

            embedValues = [...embedValues, ...result.embeddings];
        }

        logger.debug`LLM result length: ${embedValues.length}`;
        // logger.debug`LLM embedings: ${result.embeddings}`;
        return embedValues;
    } catch (error) {
        logger.error`Error embedding batches of strings: ${error}`;
        throw error;
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

function* batchGenerator<T>(
    array: T[],
    batchSize: number
): Generator<T[], void, unknown> {
    if (batchSize <= 0) {
        throw new Error("Batch size must be a positive integer.");
    }

    for (let i = 0; i < array.length; i += batchSize) {
        yield array.slice(i, i + batchSize);
    }
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

export function htmlGenerator(
    VideoTitle: string,
    imageUrl: string,
    videoId: string,
    topicSections: ProcessedTopicResult[]
): string {
    // Start building the HTML using template literals
    let htmlTemplate = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Youtube Made Simple</title>
                <!-- Using Tailwind CSS CDN -->
                <link
                  rel="stylesheet"
                  href="https://unpkg.com/tailwindcss@2.2.19/dist/tailwind.min.css"
                />
                <!-- Google Font for a handwriting style -->
                <link rel="preconnect" href="https://fonts.gstatic.com" />
                <link
                  href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap"
                  rel="stylesheet"
                />
                <style>
                    body {
                        background-color: #f7fafc; /* bg-gray-100 */
                        font-family: 'Patrick Hand', sans-serif;
                    }
                    h1, h2 {
                        font-weight: 700; /* font-bold equivalent */
                        margin-bottom: 0.5rem; /* mb-2 */
                    }
                    ul {
                        list-style-type: disc;
                        margin-left: 1.5rem; /* ml-6 */
                        margin-bottom: 1.5rem; /* mb-6 */
                    }
                    li {
                        margin-bottom: 1rem; /* mb-4 */
                    }
                    ol {
                        list-style-type: decimal;
                        margin-left: 2rem; /* ml-8 */
                        margin-top: 0.5rem; /* mt-2 */
                    }
                    ol li {
                        margin-bottom: 0.2rem; /* Adjust as needed */
                    }
                    .bullet-content ol {
                        margin-top: 0.3rem; /* Adjust as needed */
                        margin-bottom: 0.3rem; /* Adjust as needed */
                        padding-left: 0.3rem;
                    }
                </style>
        </head>
        <body class="min-h-screen flex items-center justify-center p-4">
            <div class="max-w-2xl w-full bg-white rounded-2xl shadow-lg p-6">
                <!-- Attribution header -->
                <div class="mb-6 text-right text-gray-500 text-sm">
                  Generated by 
                  <a href="https://github.com/The-Pocket/Tutorial-Youtube-Made-Simple" 
                     class="underline hover:text-gray-700">
                    Youtube Made Simple
                  </a>
                </div>
                <!-- Title 1 -->
                <a href="https://youtube.com/${videoId}" 
                     class=" hover:underline">
                    <h1 class="text-4xl text-gray-800 mb-4">${VideoTitle}</h1>
                  </a>
                <!-- Image below Title 1 -->
                <img
                  src="${imageUrl}"
                  alt="Placeholder image"
                  class="rounded-xl mb-6"
                />`;

    // For each section, add a sub-title (Title 2, etc.) and bullet points.
    for (const section of topicSections) {
        const sectionTitle = section.rephrasedTitle || section.title; // Use default empty string if title is missing
        const bullets = section.questions; // Use default empty array if bullets are missing

        // Add the section's title (Title 2, Title 3, etc.)
        htmlTemplate += `
                <h2 class="text-2xl text-gray-800 mb-4">${sectionTitle}</h2>
                <ul class="text-gray-600">`;

        // Create list items for each bullet pair
        for (let i = 0; i < bullets.length; i++) {
            htmlTemplate += `
                    <li>
                        <strong aria-label="${bullets[i].original}">${bullets[i].rephrased}</strong><br />
                        <div class="bullet-content">${bullets[i].answer}</div>
                    </li>`;
        }
        htmlTemplate += `
                </ul>`;
    }

    // Close the main container and body
    htmlTemplate += `
                </div>
            </body>
        </html>`;

    return htmlTemplate;
}
