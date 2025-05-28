import {
    // ansiColorFormatter,
    configure,
    getConsoleSink,
    // getLevelFilter,
    getAnsiColorFormatter,
    withFilter,
    getLogger,
} from "@logtape/logtape";
import { getFileSink } from "@logtape/file";
// import { getYoutubeInfo } from "./google.auth";
// import * as utils from "./utils";
// import { Database } from "./database";
// import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";
// import type { YoutubeInfo } from "./comments.dto";
import {
    CommentsEmbedsProcessing,
    ContentBatch,
    ExtractTopicsAndQuestions,
    GenerateHTML,
    ProcessContent,
    ProcessYoutubeURL,
    SearchBatchNode,
    TopicsSimilaritySearch,
    type MyGlobal,
} from "./flow";
import { Flow, ParallelFlow } from "./pocket";
import { Database } from "./database";
// import type { Database } from "./database";

const logger = getLogger(["Dbg", "App", "Main"]);

await (async () => {
    await configure({
        sinks: {
            console: getConsoleSink({
                formatter: getAnsiColorFormatter({
                    timestamp: "time",
                    timestampColor: "cyan",
                }),
            }),
            appLogFile: getFileSink("./log/app.log"),
            errorLogFile: withFilter(getFileSink("./log/error.log"), "error"),
        },
        filters: {},
        loggers: [
            {
                category: "Dbg",
                lowestLevel: "debug",
                sinks: ["console", "appLogFile", "errorLogFile"],
            },
            {
                category: ["App", "Err"],
                lowestLevel: "info",
                sinks: ["console", "appLogFile", "errorLogFile"],
            },
        ],
    });

    const db = await Database.create();

    try {
        const youtubeUrl = new ProcessYoutubeURL(
            "https://www.youtube.com/watch?v=Lfr2KvIS2nY"
            // "https://www.youtube.com/watch?v=mgoCr7STbh4"
        );
        const extractTopics = new ExtractTopicsAndQuestions();
        const commentsEmbedNode = new CommentsEmbedsProcessing();
        youtubeUrl.next(extractTopics).next(commentsEmbedNode);

        const preProccessFlow = new Flow(youtubeUrl);

        // * Similarity Search Flow
        const triggerSearchBatch = new SearchBatchNode();
        const topicsSimilaritySearch = new TopicsSimilaritySearch();
        triggerSearchBatch.on("process_one", topicsSimilaritySearch);

        const parallelBatchFlow = new ParallelFlow(triggerSearchBatch, {
            maxVisits: 5000000,
        });

        // * Content Processing Flow
        const contentBatch = new ContentBatch();
        const contentProcessing = new ProcessContent();
        contentBatch.on("process_one", contentProcessing);

        const contentBatchFlow = new ParallelFlow(contentBatch, {
            maxVisits: 5000000,
        });

        // * Post Processing Flow
        const htmlNode = new GenerateHTML();
        const postProccessFlow = new Flow(htmlNode);

        // * Link Flows
        preProccessFlow.next(parallelBatchFlow);
        parallelBatchFlow.next(contentBatchFlow);
        contentBatchFlow.next(postProccessFlow);

        // Create the master flow, starting with the paymentFlow
        const masterPipeline = new Flow(preProccessFlow);

        const memory: MyGlobal = {
            db,
        };
        await masterPipeline.run(memory);

        db.close();
    } catch (error) {
        db.close();
        logger.error`Error: ${error}`;
        //TODO YAMLParseError is same as llm response error
    }

    console.log("App shutdown");
})();
