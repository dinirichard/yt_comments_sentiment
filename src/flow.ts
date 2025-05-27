import { getLogger } from "@logtape/logtape";
import { Node, DEFAULT_ACTION, Memory } from "./pocket";
import * as utils from "./utils";
import { Database } from "./database";
import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";
import { getYoutubeInfo } from "./google.auth";
import type { CommentData, YoutubeInfo } from "./comments.dto";
import yaml from "yaml";
import { createBatchEmbeddings } from "./utils";
import type { ContentEmbedding } from "@google/generative-ai";
import type { DuckDBValue } from "@duckdb/node-api";

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
    pathSpecificData?: string;
    topics?: string;
};
interface MyLocal {
    pathSpecificData?: string;
}

export class ProcessYoutubeURL extends Node {
    // protected execRunner(memory: Memory<SharedStore, SharedStore>, prepRes: any): Promise<any> {
    //     throw new Error("Method not implemented.");
    // }
    private url: string;
    constructor(url: string) {
        super();
        this.url = url;
    }

    async prep(memory: Memory<MyGlobal, MyLocal>): Promise<any> {
        logger.info`Setup database and process youtube url for video Id.`;
        const videoId = utils.retrieveVideoId(this.url);
        const db = await Database.create();
        await db.createTables();
        memory.videoId = videoId;
        memory.db = db;

        const videoSaved: DuckDBResultReader = await db.queryGet(
            `   SELECT 1
                        FROM videos
                        WHERE id = '${videoId}';
                    `
        );
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
        memory: Memory<MyGlobal, MyLocal>,
        prepRes: any,
        execRes: YoutubeInfo
    ): Promise<void> {
        memory.youtubeInfo = execRes;
        this.trigger(DEFAULT_ACTION);
    }
}

export class ExtractTopicsAndQuestions extends Node {
    prep(memory: Memory<MyGlobal, MyLocal>): Promise<string> {
        const prompt: string = `
            You are an expert content analyzer. Given a YouTube video transcript, identify at least 2 or more most interesting topics discussed and generate at most 3 most thought-provoking questions for each topic.
            These questions don't need to be directly asked in the video. It's good to have clarification questions.

            VIDEO TITLE: ${memory.youtubeInfo.title}

            TRANSCRIPT:
            ${memory.youtubeInfo.transcript}

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
        const response = await utils.callLLM(prepRes);
        logger.debug`llm response: ${response}`;
        const yamlContent = utils.extractYamlContent(response);

        const parsed = yaml.parse(yamlContent);
        logger.debug`Parsed yaml: ${parsed}`;
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
        logger.debug`Parsed yaml: ${parentChild}`;
        return { parsed, parentChild, transcriptEmbeddings };
    }

    async post(
        memory: Memory<MyGlobal, MyLocal>,
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
            let parentIndex = 0;
            await execRes.parsed.topics.forEach(
                async (element: { title: string; questions: string[] }) => {
                    const titleId = utils.makeId(11);
                    parentIndex++;
                    await memory.db.connect.run(
                        `
                        insert into transcripts_embeddings (id, videoId, text, embedding)
                            values (?, ?, ?, list_value(${execRes.transcriptEmbeddings[parentIndex - 1].values.map(() => "?").join(", ")}));
                        `,
                        [
                            titleId,
                            memory.videoId as string,
                            element.title,
                            ...execRes.transcriptEmbeddings[parentIndex - 1]
                                .values,
                        ]
                    );
                    element.questions.forEach(async (question) => {
                        parentIndex++;
                        const questionId = utils.makeId(11);
                        await memory.db.connect.run(
                            `
                            insert into transcripts_embeddings (id, videoId, parentId, text, embedding)
                                values (?, ?, ?, ?, list_value(${execRes.transcriptEmbeddings[parentIndex - 1].values.map(() => "?").join(", ")}));
                            `,
                            [
                                titleId + "." + questionId,
                                memory.videoId as string,
                                titleId,
                                question,
                                ...execRes.transcriptEmbeddings[parentIndex - 1]
                                    .values,
                            ]
                        );
                    });
                }
            );

            await memory.db.connect.run(
                `CREATE INDEX transcripts_vector_index ON transcripts_embeddings USING HNSW (embedding);`
            );

            logger.info`Inserted transcript embeddings.`;
        } else {
            await memory.db.connect.run(
                `CREATE INDEX transcripts_vector_index ON transcripts_embeddings USING HNSW (embedding);`
            );
            logger.info`Transcript embeddings have already been generated and saved.`;
        }

        this.trigger(DEFAULT_ACTION);
    }
}

export class CommentsEmbedsProcessing extends Node {
    async prep(memory: Memory<MyGlobal, MyLocal>): Promise<any> {
        const transEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `SELECT commentId, textDisplay
                    FROM comments
                    WHERE videoId = '${memory.videoId}' AND (parentId IS NULL OR parentId = '');
            `
        );

        const parentComments = transEmbedTable.getRows();
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
        prepRes: any,
        execRes: ContentEmbedding[],
        memory: Memory<MyGlobal, MyLocal>
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
                `
                            insert into comments_embeddings (videoId, commentId, text, embedding)
                                values (?, ?, ?, list_value(${execRes[i].values.map(() => "?").join(", ")}));
                            `,
                [
                    memory.videoId as string,
                    prepRes.parentComments[i][0] as string,
                    yamlComments[i],
                    ...execRes[i].values,
                ]
            );
        }
        this.trigger(DEFAULT_ACTION);
    }
}

export class TopicsSimilaritySearch extends Node<MyGlobal, MyLocal> {
    async prep(memory: Memory<MyGlobal, MyLocal>): Promise<any> {
        logger.info`Comments embeddings have already been generated and saved.`;
        logger.debug`Flow Params: \n${memory.item_data[0]} : ${memory.item_data[2]}`;

        const commentsTopicsMatch: DuckDBResultReader =
            await memory.db.queryGet(
                `   
                    SELECT id, parentId, text, embedding
                    FROM transcripts_embeddings
                    WHERE videoId = '${memory.videoId}'
                    ORDER BY array_distance(embedding::FLOAT[768], ARRAY[${memory.item_data[1].items}]::FLOAT[768])
                    LIMIT 1;
            `
            );

        const commentsTopics = commentsTopicsMatch.getRows();

        // logger.debug`commentsTopics: ${commentsTopics}`;
        // logger.debug`commentsTopics Text: ${commentsTopics[2]}`;

        commentsTopics.map((topics) => {
            return [topics[0], topics[2]];
        });

        return {
            commentsTopics,
            commentId: memory.item_data[0],
            commentText: memory.item_data[2],
        };
    }
    async exec(prepRes: any): Promise<{ similarTopics: any; commentId: any }> {
        return Promise.resolve({
            similarTopics: prepRes.commentsTopics,
            commentId: prepRes.commentId,
            commentText: prepRes.commentText,
        });
    }

    async post(
        memory: Memory<MyGlobal, MyLocal>,
        prepRes: any,
        execRes: any
    ): Promise<void> {
        memory.commentsTopicMatch = [...memory.commentsTopicMatch, execRes];
        logger.debug`Combined Result: ${execRes}`;
        this.trigger(DEFAULT_ACTION);
    }
}

export class SearchBatchNode extends Node<
    MyGlobal,
    MyLocal,
    ["process_one", "aggregate"]
> {
    async prep(memory: Memory<MyGlobal, MyLocal>): Promise<any[]> {
        // There is no way this would complete in 3 seconds without concurrency
        logger.info`SearchBatchFlow creating comments_embeddings batches.`;
        const commEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `   
                    SELECT ce.commentId, ce.embedding, c.textDisplay
                    FROM comments_embeddings ce
                    LEFT JOIN
                        comments c ON ce.commentId = c.commentId
                    WHERE ce.videoId = '${memory.videoId}';
            `
        );
        const commEmbedd = commEmbedTable.getRows();
        logger.debug`commEmbedd length: ${commEmbedd.length}`;

        // logger.debug`commEmbedd Text: ${commEmbedd.map((sd) => sd[2])}`;

        return commEmbedd;
    }

    async post(
        memory: Memory<MyGlobal, MyLocal>,
        items: DuckDBValue[][]
    ): Promise<void> {
        // memory.results = new Array(items.length).fill(null); // Pre-allocate
        items.forEach((item) => {
            this.trigger("process_one", {
                item_data: item,
            });
        });
        // Optional: this.trigger("aggregate");
        memory.db.close();
    }
}
