import type { DuckDBValue } from "@duckdb/node-api";
import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";
import type { MyGlobal } from "./flow";
import { getLogger } from "@logtape/logtape";
import {
    Node,
    // DEFAULT_ACTION,
    type Memory,
} from "./pocket";
import type { ProcessedComments, VssComments } from "./utils/comments.dto";
import { createFile } from "./utils/utils";
import { htmlVssGenerator } from "./utils/html";

const logger = getLogger(["Dbg", "App", "Vss"]);

export class SearchBatchNode extends Node<
    MyGlobal,
    {},
    any,
    ["process_one", "aggregate"]
> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any[]> {
        // There is no way this would complete in 3 seconds without concurrency
        logger.info`SearchBatchFlow creating comments_embeddings batches.`;
        const transEmbedTable: DuckDBResultReader = await memory.db.queryGet(
            `   
                    SELECT id, parentId, text, embedding
                    FROM transcripts_embeddings
                    WHERE videoId = '${memory.videoId}';
            `
        );
        const transcriptEmbedd = transEmbedTable.getRows();
        logger.debug`transcriptEmbedd length: ${transcriptEmbedd.length}`;
        // logger.debug`transcriptEmbedd: ${JSON.stringify(
        //     transcriptEmbedd.map((topics) => {
        //         return [topics[0], topics[1], topics[2]];
        //     })
        // )}`;

        // logger.debug`commEmbedd Text: ${commEmbedd.map((sd) => sd[2])}`;

        return transcriptEmbedd;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        items: DuckDBValue[][]
    ): Promise<void> {
        logger.info`TopicsSimilaritySearch begins.`;
        const vssLimit = 3;
        memory.commentsTopicMatch = new Array(items.length).fill(null); // Pre-allocate
        items.forEach((item, index) => {
            this.trigger("process_one", {
                item_data: item,
                item_index: index,
                vssLimit,
            });
        });
    }
}

export class TopicsSimilaritySearch extends Node<MyGlobal, any> {
    async prep(memory: Memory<MyGlobal, any>): Promise<any> {
        // logger.info`TopicsSimilaritySearch begins.`;

        const commentsTopicsMatch: DuckDBResultReader =
            await memory.db.queryGet(
                `   
                    SELECT ce.commentId, ce.embedding, c.textDisplay, c.parentId, c.likeCount
                    FROM comments_embeddings ce
                    LEFT JOIN
                        comments c ON ce.commentId = c.commentId
                    WHERE ce.videoId = '${memory.videoId}'
                    ORDER BY array_cosine_distance(ce.embedding::FLOAT[768], ARRAY[${memory.item_data[3].items}]::FLOAT[768])
                    LIMIT ${memory.vssLimit};
            `
            );

        const commentsTopics = commentsTopicsMatch.getRows();

        // logger.debug`commentsTopics: ${commentsTopics}`;

        const commentsTopicsr = commentsTopics.map((topics) => {
            return {
                id: topics[0],
                textDisplay: topics[2],
                parentId: topics[3],
                likeCount: topics[4],
            } as ProcessedComments;
            // return [topics[0], topics[2]];
        });

        return {
            comments: commentsTopicsr,
            topicTranscriptId: memory.item_data[0],
            topicText: memory.item_data[2],
        };
    }
    async exec(prepRes: any): Promise<VssComments> {
        return {
            similarComments: prepRes.comments,
            topicTranscriptId: prepRes.topicTranscriptId,
            topicText: prepRes.topicText,
        } as VssComments;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: any
    ): Promise<void> {
        memory.commentsTopicMatch[memory.item_index] = execRes;
    }
}

export class PostVss extends Node<MyGlobal, any, any, any> {
    async prep(memory: Memory<MyGlobal, {}>): Promise<any> {
        logger.info`-----POST VSS----`;

        // logger.debug`Matches (): \n${JSON.stringify(memory.commentsTopicMatch)}`;
        const vssComments: VssComments[] = memory.commentsTopicMatch!;

        const commentsTable: DuckDBResultReader = await memory.db.queryGet(
            `   
                    SELECT commentId, textDisplay, parentId, likeCount,
                    FROM comments
                    WHERE videoId = '${memory.videoId}';
            `
        );

        const allComments = commentsTable.getRows();
        // logger.debug`Matches (): \n${vssComments}`;

        vssComments.forEach((vssComment: VssComments) => {
            vssComment.similarComments.forEach(
                (parentComments: ProcessedComments) => {
                    const childComments: ProcessedComments[] = allComments
                        .filter((c) => c[2] === parentComments.id)
                        .map((c) => {
                            return {
                                id: c[0],
                                textDisplay: c[1],
                                parentId: c[2],
                                likeCount: c[3],
                            } as ProcessedComments;
                        });
                    parentComments.replies = childComments;
                    return parentComments;
                }
            );
            return vssComment;
        });

        logger.debug`Matches (): \n${JSON.stringify(vssComments)}`;
        return {
            VideoTitle: memory.youtubeInfo?.videoTitle,
            imageUrl: memory.youtubeInfo?.thumbnailUrl,
            videoId: memory.videoId,
            vssComments,
        };
    }
    async exec(prepRes: {
        VideoTitle: string;
        imageUrl: string;
        videoId: string;
        vssComments: VssComments[];
    }): Promise<any> {
        const htmlContent = htmlVssGenerator(
            prepRes.VideoTitle,
            prepRes.imageUrl,
            prepRes.videoId,
            prepRes.vssComments
        );

        return htmlContent;
    }

    async post(
        memory: Memory<MyGlobal, any>,
        prepRes: any,
        execRes: string
    ): Promise<void> {
        let videoPath: string =
            "./summaries/comments/" + prepRes.VideoTitle + ".html";
        videoPath = videoPath.replaceAll(" ", "_");

        await createFile(execRes, videoPath);

        // this.trigger("summarized");
    }
}
