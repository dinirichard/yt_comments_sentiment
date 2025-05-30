import type { DuckDBValue } from "@duckdb/node-api";
import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";
import type { MyGlobal } from "./flow";
import { getLogger } from "@logtape/logtape";
import {
    Node,
    // DEFAULT_ACTION,
    type Memory,
} from "./pocket";
// import * as utils from "./utils";

const logger = getLogger(["Dbg", "App", "Vss"]);

// interface MyLocal {
//     pathSpecificData?: string;
// }

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
                    SELECT ce.commentId, ce.embedding, c.textDisplay
                    FROM comments_embeddings ce
                    LEFT JOIN
                        comments c ON ce.commentId = c.commentId
                    WHERE ce.videoId = '${memory.videoId}'
                    ORDER BY array_cosine_distance(ce.embedding::FLOAT[768], ARRAY[${memory.item_data[3].items}]::FLOAT[768])
                    LIMIT ${memory.vssLimit};
            `
            );

        let commentsTopics = commentsTopicsMatch.getRows();

        // logger.debug`commentsTopics: ${commentsTopics}`;

        commentsTopics = commentsTopics.map((topics) => {
            return [topics[0], topics[2]];
        });

        return {
            comments: commentsTopics,
            topicTranscriptId: memory.item_data[0],
            topicText: memory.item_data[2],
        };
    }
    async exec(prepRes: any): Promise<{
        similarComments: any;
        topicTranscriptId: any;
        topicText: any;
    }> {
        return {
            similarComments: prepRes.comments,
            topicTranscriptId: prepRes.topicTranscriptId,
            topicText: prepRes.topicText,
        };
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
    async prep(memory: Memory<MyGlobal, any>): Promise<void> {
        logger.info`-----POST VSS----`;

        // logger.debug`Matches (): \n${memory.commentsTopicMatch.filter(
        //     (x: any) => x !== null
        // )}`;
        logger.debug`Matches (): \n${JSON.stringify(memory.commentsTopicMatch)}`;
    }
    async exec(): Promise<any> {}

    async post(): Promise<void> {
        // this.trigger("summarized");
    }
}
