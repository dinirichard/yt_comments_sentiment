import { getLogger } from "@logtape/logtape";
import { Node, DEFAULT_ACTION, type Memory } from "./pocket";
import * as utils from "./utils/utils";
import { Database } from "./utils/database";
import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";
import { getYoutubeInfo } from "./utils/google.auth";
import type {
    CommentData,
    VssComments,
    YoutubeInfo,
} from "./utils/comments.dto";
import yaml from "yaml";
import { type ProcessedTopicResult, type Section } from "./utils/utils";
import type { ContentEmbedding } from "@google/generative-ai";
import { callLLM, createBatchEmbeddings } from "./utils/llm";
import { htmlSummaryGenerator } from "./utils/html";

const logger = getLogger(["Dbg", "App", "Flw"]);

export type MyGlobal = {
    youtubeInfo?: {
        videoId?: string;
        videoTitle?: string;
        transcript?: string;
        comments?: CommentData[];
        thumbnailUrl?: string;
    };
    videoId?: string;
    db: Database;
    summary: boolean;
    pathSpecificData?: string;
    topics?: any[];
    commentsTopicMatch?: VssComments[];
};

export class ProcessYoutubeURL extends Node<
    MyGlobal,
    any,
    any,
    ["default", "summarized"]
> {
    private url: string;
    constructor(url: string) {
        super();
        this.url = url;
    }

    async prep(memory: Memory<MyGlobal, any>): Promise<any> {
        logger.info`Setup database and process youtube url for video Id.`;
        const videoId = utils.retrieveVideoId(this.url);
        await memory.db.createTables();
        memory.videoId = videoId;
        const db: Database = memory.db;

        const videoSaved: DuckDBResultReader = await memory.db.queryGet(
            `   SELECT 
                    v.htmlSummary,
                FROM 
                    videos v
                WHERE 
                    v.id = '${videoId}';
                    `
        );

        const htmlSummary =
            videoSaved.currentRowCount !== 1
                ? null
                : (videoSaved.getRows()[0][0] as string);
        memory.summary = htmlSummary === "" || !htmlSummary ? false : true;
        return { videoId, videoSaved, db };
    }

    async exec(prepRes: {
        videoId: string;
        videoSaved: DuckDBResultReader;
        db: Database;
    }): Promise<any> {
        if (!prepRes) {
            throw new Error("Method not implemented.");
        }

        logger.info`Proccesing Youtube Url ${prepRes.videoId}`;

        let youtubeInfo: YoutubeInfo;
        if (prepRes.videoSaved.currentRowCount !== 1) {
            youtubeInfo = await getYoutubeInfo(prepRes.videoId);

            await prepRes.db.insertVideo(
                prepRes.videoId,
                youtubeInfo.videoTitle,
                youtubeInfo.thumbnailUrl
            );
            await prepRes.db.insertTranscript(
                prepRes.videoId,
                youtubeInfo.transcript
            );
            await prepRes.db.appendComments(
                prepRes.videoId,
                youtubeInfo.comments
            );
            logger.debug(`Data has been saved.`);
        } else {
            logger.debug(`Video data already exist`);
            const videoInfo: DuckDBResultReader = await prepRes.db.queryGet(`
                    SELECT
                        v.id,
                        v.title,
                        v.thumbnailUrl,
                    FROM
                        videos v
                    WHERE
                        v.id = '${prepRes.videoId}';
                `);

            const videoComments: DuckDBResultReader = await prepRes.db
                .queryGet(`
                    SELECT
                        c.commentId,
                        c.textDisplay,
                        c.parentId,
                        c.likeCount,
                        c.publishedAt,
                        c.totalReplyCount
                    FROM
                        comments c
                    WHERE
                        c.videoId = '${prepRes.videoId}';
            `);

            const videoTranscript: DuckDBResultReader = await prepRes.db
                .queryGet(`
                    SELECT
                        t.original,
                    FROM
                        transcripts t
                    WHERE
                        t.videoId = '${prepRes.videoId}';
            `);
            youtubeInfo = {
                videoId: videoInfo.getRows()[0][0] as string,
                videoTitle: videoInfo.getRows()[0][1] as string,
                thumbnailUrl: videoInfo.getRows()[0][2] as string,
                transcript: videoTranscript.getRows()[0][0] as string,
                comments:
                    videoComments.getRowsJson() as unknown as CommentData[],
            };
        }

        return youtubeInfo;
    }
    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: YoutubeInfo
    ): Promise<void> {
        memory.youtubeInfo = execRes;
        this.trigger(
            (memory.summary as boolean) ? "summarized" : DEFAULT_ACTION
        );
    }
}

export class ExtractTopicsAndQuestions extends Node<
    MyGlobal,
    any,
    any,
    ["default", "summarized"]
> {
    prep(memory: Memory<MyGlobal, {}>): Promise<string> {
        logger.info`Starting  Transcript embeddings.`;
        const prompt: string = `
            You are an expert content analyzer. Given a YouTube video transcript, identify at least 2 or more most interesting topics discussed and generate at most 3 most thought-provoking questions for each topic.
            These questions don't need to be directly asked in the video. It's good to have clarification questions.

            VIDEO TITLE: ${memory.youtubeInfo!.videoTitle}

            TRANSCRIPT:
            ${memory.youtubeInfo!.transcript}

            Format your response in YAML:

            \`\`\`yaml
            topics:
                - title: |
                    First Topic Title
                  questions:
                    -   |
                        Question 1 about first topic?
                    -   |
                        Question 2 ...
                - title: |
                    Second Topic Title
                  questions:
                        ...
            \`\`\`
        `;

        return Promise.resolve(prompt);
    }

    async exec(prepRes: string): Promise<any> {
        const response = await callLLM(prepRes);
        logger.debug`llm response: ${response}`;
        const yamlContent = utils.extractYamlContent(response);

        const parsed = yaml.parse(yamlContent);
        logger.debug`Parsed yaml: ${JSON.stringify(parsed)}`;
        const parentChild: string[] = [];
        parsed.topics.forEach(
            (element: { title: string; questions: string[] }) => {
                parentChild.push(element.title);
                element.questions.forEach((question) => {
                    parentChild.push(question);
                });
            }
        );

        const transcriptEmbeddings: ContentEmbedding[] =
            await createBatchEmbeddings(parentChild);
        logger.debug`ParentChild comments list: ${parentChild}`;
        return { parsed, parentChild, transcriptEmbeddings };
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: {
            parsed: any;
            parentChild: string[];
            transcriptEmbeddings: ContentEmbedding[];
        }
    ): Promise<void> {
        const transEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `SELECT *
                    FROM transcripts_embeddings
                    WHERE videoId = '${memory.videoId}';
            `
        );

        logger.debug`transEmbedTable: ${transEmbedTable}`;

        if (transEmbedTable.currentRowCount === 0) {
            let embeddingIndex = 0;
            for (const element of execRes.parsed.topics) {
                const titleId = utils.makeId(11);
                // Assuming the embedding for the title is at the current embeddingIndex
                if (embeddingIndex >= execRes.transcriptEmbeddings.length) {
                    console.error(
                        "Ran out of embeddings for title:",
                        element.title
                    );
                    continue; // Or handle error appropriately
                }
                const titleEmbedding =
                    execRes.transcriptEmbeddings[embeddingIndex];
                embeddingIndex++;

                await memory.db.connect.run(
                    `
                    insert into transcripts_embeddings (id, videoId, text, embedding)
                        values (?, ?, ?, list_value(${titleEmbedding.values.map(() => "?").join(", ")}));
                    `,
                    [
                        titleId,
                        memory.videoId as string,
                        element.title,
                        ...titleEmbedding.values,
                    ]
                );

                for (const question of element.questions) {
                    const questionId = utils.makeId(11);
                    // Assuming the embedding for the question is at the current embeddingIndex
                    if (embeddingIndex >= execRes.transcriptEmbeddings.length) {
                        console.error(
                            "Ran out of embeddings for question:",
                            question
                        );
                        continue; // Or handle error appropriately
                    }
                    const questionEmbedding =
                        execRes.transcriptEmbeddings[embeddingIndex];
                    embeddingIndex++;

                    await memory.db.connect.run(
                        `
                        insert into transcripts_embeddings (id, videoId, parentId, text, embedding)
                            values (?, ?, ?, ?, list_value(${questionEmbedding.values.map(() => "?").join(", ")}));
                        `,
                        [
                            `${titleId}.${questionId}`, // Ensured id is unique
                            memory.videoId as string,
                            titleId,
                            question,
                            ...questionEmbedding.values,
                        ]
                    );
                }
            }

            await memory.db.connect.run(
                `DROP INDEX IF EXISTS transcripts_vector_index;`
            );

            await memory.db.connect.run(
                `CREATE INDEX IF NOT EXISTS transcripts_vector_index ON transcripts_embeddings USING HNSW (embedding) WITH (metric = 'cosine');`
            );

            logger.info`Inserted transcript embeddings.`;
        } else {
            logger.info`Transcript embeddings have already been generated and saved.`;
        }

        this.trigger(DEFAULT_ACTION);
    }
}

export class CommentsEmbedsProcessing extends Node<
    MyGlobal,
    any,
    any,
    ["default", "summarized"]
> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any> {
        logger.info`Starting  Comments embeddings.`;
        const transEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `SELECT commentId, textDisplay
                    FROM comments
                    WHERE videoId = '${memory.videoId}' AND (parentId IS NULL OR parentId = '');
            `
        );

        const parentComments = transEmbedTable.getRows();
        logger.debug`comments length: ${parentComments.length}`;
        const yamlOutput = [];

        for (const parent of parentComments) {
            const repliesRes: DuckDBResultReader = await memory.db.queryGet(
                `
                        SELECT textDisplay
                        FROM comments
                        WHERE parentId = '${parent[0]}'
                    `
            );

            const replies = repliesRes.getRows();
            const commentEntry: { mainComment: string; replies?: string[] } = {
                mainComment: parent[1] as string,
            };

            if (replies.length > 0) {
                commentEntry.replies = replies.map(
                    (reply) => reply[0] as string
                );
            }

            yamlOutput.push(commentEntry);
        }

        const commEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `SELECT *
                    FROM comments_embeddings
                    WHERE videoId = '${memory.videoId}';
            `
        );

        logger.debug`commEmbedTable: ${commEmbedTable}`;
        logger.debug`parentComments length: ${parentComments.length}`;
        logger.debug`yamlOutput length: ${yamlOutput.length}`;

        return {
            parentComments,
            parentChildComments: yamlOutput,
            embeddExists: commEmbedTable.currentRowCount,
        };
    }

    async exec(prepRes: any): Promise<any> {
        logger.debug`Start embedding parent child comments`;

        if (prepRes.embeddExists > 0) {
            logger.info`Comments embeddings have already been generated and saved.`;
            return [];
        }

        const yamlComments: string[] = prepRes.parentChildComments.map(
            (comments: { mainComment: string; replies?: string[] }) =>
                yaml.stringify(comments)
        );
        logger.debug`yamlComments: ${yamlComments.length}`;

        const commentEmbeddings: ContentEmbedding[] =
            await createBatchEmbeddings(yamlComments);

        logger.debug`commentEmbeddings: ${commentEmbeddings.length}`;
        logger.info`Retrieved comments embeddings.`;
        return commentEmbeddings;
    }
    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: ContentEmbedding[]
    ): Promise<void> {
        if (prepRes.embeddExists > 0) {
            logger.info`Comments embeddings have already been generated and saved.`;
            this.trigger(DEFAULT_ACTION);
        }

        for (let i = 0; i < execRes.length; i++) {
            const yamlComments: string[] = prepRes.parentChildComments.map(
                (comments: { mainComment: string; replies?: string[] }) =>
                    yaml.stringify(comments)
            );
            await memory.db.connect.run(
                `           insert into comments_embeddings (videoId, commentId, text, embedding)
                                values (?, ?, ?, list_value(${execRes[i].values.map(() => "?").join(", ")}));
                            `,
                [
                    memory.videoId as string,
                    prepRes.parentComments[i][0] as string,
                    yamlComments[i],
                    ...execRes[i].values,
                ]
            );

            await memory.db.connect.run(
                `DROP INDEX IF EXISTS comments_vector_index;`
            );

            await memory.db.connect.run(
                `CREATE INDEX IF NOT EXISTS comments_vector_index ON comments_embeddings USING HNSW (embedding) WITH (metric = 'cosine');`
            );
        }
        this.trigger(DEFAULT_ACTION);
    }
}

export class testNode extends Node<
    MyGlobal,
    any,
    any,
    ["default", "summarized"]
> {
    async prep(memory: Memory<MyGlobal, {}>): Promise<void> {
        logger.info`-----TEST NODE----`;
    }
    async exec(prepRes: any): Promise<any> {}

    async post(
        memory: Memory<MyGlobal, {}>,
        prepRes: any,
        execRes: any
    ): Promise<void> {
        this.trigger("summarized");
    }
}

export class ContentBatch extends Node<
    MyGlobal,
    {},
    ["process_one", "aggregate"]
> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any[]> {
        // There is no way this would complete in 3 seconds without concurrency
        logger.info`ContentBatchFlow creating topics and questions batches.`;
        const transEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `SELECT id, parentId, text
                    FROM transcripts_embeddings
                    WHERE videoId = '${memory.videoId}';
            `
        );

        const allPoints = transEmbedTable.getRows();
        const sections: utils.Section[] = [];

        for (const topic of allPoints) {
            if (topic[1] !== null) {
                continue;
            }
            const section: utils.Section = {
                title: topic[2] as string,
                questions: [],
            };

            for (const question of allPoints) {
                if (question[1] === null || topic[0] !== question[1]) {
                    continue;
                }
                section.questions.push([question[2] as string, ""]);
            }
            sections.push(section);
        }
        // logger.debug`Sections : ${sections}`;

        return sections;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepResList: Section[]
    ): Promise<void> {
        memory.topics = new Array(prepResList.length).fill(null);
        // memory.local.topic = new Array(prepResList.length).fill(null);

        prepResList.forEach((section, index) => {
            this.trigger("process_one", {
                section_data: section,
                section_index: index,
            });
        });
    }
}

export class ProcessContent extends Node<MyGlobal, any> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any> {
        // logger.debug`ProcessContent prep Result 1: ${memory.section_data}`;
        const topicTitle: string = memory.section_data.title;
        // Extract only the original question strings from the input
        const originalQuestions = memory.section_data.questions.map(
            (q: string[]) => q[0]
        );

        const prompt: string = `You simplify and clarify content. Given a topic and questions from a YouTube video, refine the topic title and questions for clarity, and provide easy-to-understand explanations using the transcript.

            TOPIC: ${topicTitle}

            QUESTIONS:
            ${originalQuestions.map((q: string) => `- ${q}`).join("\n")}

            TRANSCRIPT EXCERPT:
            ${memory.youtubeInfo.transcript}

            For topic title and questions:
            1. Keep them catchy and interesting, but short

            For your answers:
            1. Format them using HTML with <b> and <i> tags for highlighting. 
            2. Prefer lists with <ol> and <li> tags. Ideally, <li> followed by <b> for the key points.
            3. Quote important keywords but explain them in easy-to-understand language (e.g., "<b>Quantum computing</b> is like having a super-fast magical calculator")
            4. Keep answers interesting but short

            Format your response in YAML:

            \`\`\`yaml
            rephrasedTitle: |
                Interesting topic title in 10 words
            questions:
              - original: |
                    ${originalQuestions.length > 0 ? originalQuestions[0] : ""}
                rephrased: |
                    Interesting question in 15 words
                answer: |
                    Simple answer that are easy-to-understand in 100 words
              - original: |
                    ${originalQuestions.length > 1 ? originalQuestions[1] : ""}
                rephrased: |
                    Interesting question in 15 words
                answer: |
                    Simple answer that are easy-to-understand in 100 words
            # ... add more placeholders dynamically or adjust instructions if needed ...
            \`\`\`
            `;

        // logger.debug`llm response: ${prompt}`;

        return [prompt, topicTitle, memory.section_index];
    }
    async exec(prepRes: [string, string, number]): Promise<any> {
        const response = await callLLM(prepRes[0]);
        // logger.debug`llm response: ${response}`;
        const yamlContent = utils.extractYamlContent(response);

        const parsed = yaml.parse(yamlContent);
        // logger.debug`Parsed yaml: ${parsed}`;

        const result = {
            title: prepRes[1], // Keep original title for mapping back
            rephrasedTitle: parsed.rephrasedTitle,
            questions: parsed.questions,
        };

        return result;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: any
    ): Promise<void> {
        memory.topics[prepRes[2]] = execRes;
        // memory.local.topic[prepRes[2]] = execRes;
        // logger.debug`ProcessContent Result: ${memory.topics}`;
        // throw new Error("Method not implemented.");
        // this.trigger(DEFAULT_ACTION, { topics: memory.local.topic });
    }
}

export class GenerateHTML extends Node<MyGlobal, any> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any> {
        logger.info`GenerateHTML generating and saving HTML file.`;
        logger.debug`GenerateHTML Mem Topics : ${memory.topics}`;
        return [
            memory.youtubeInfo.videoTitle,
            memory.youtubeInfo.thumbnailUrl,
            memory.videoId,
            memory.topics,
        ];
    }
    async exec(prepRes: any[]): Promise<string> {
        const htmlContent = htmlSummaryGenerator(
            prepRes[0],
            prepRes[1],
            prepRes[2],
            prepRes[3] as ProcessedTopicResult[]
        );

        logger.debug`HTML content : \n${htmlContent}`;
        return htmlContent;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any[],
        execRes: string
    ): Promise<void> {
        await memory.db.connect.run(
            `
                UPDATE videos
                    SET htmlSummary = ?
                    WHERE id = '${memory.videoId}';
            `,
            [execRes]
        );

        let videoTitle: string = prepRes[0];
        videoTitle = videoTitle.replaceAll(" ", "_");
        const htmlFile = Bun.file(`./summaries/${videoTitle}.html`);
        logger.debug`Writting html summary to file: ${videoTitle}.html`;
        // pdfPath = job.resumePath;
        try {
            if (!(await htmlFile.exists())) {
                await Bun.write(`./summaries/${videoTitle}.html`, execRes);
                logger.debug`Job data written to new file: ${videoTitle}.html`;
            } else {
                await Bun.write(htmlFile, execRes);
            }
        } catch (error) {
            logger.error`Error parsing into HTML file. ${error}`;
        }

        this.trigger(DEFAULT_ACTION);
    }
}
