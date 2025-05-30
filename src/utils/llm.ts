import {
    GoogleGenerativeAI,
    type BatchEmbedContentsRequest,
    type ContentEmbedding,
} from "@google/generative-ai";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["Dbg", "App", "Llm"]);

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
