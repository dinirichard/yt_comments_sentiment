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
    ExtractTopicsAndQuestions,
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

    try {
        const youtubeUrl = new ProcessYoutubeURL(
            // "https://www.youtube.com/watch?v=Lfr2KvIS2nY"
            "https://www.youtube.com/watch?v=mgoCr7STbh4"
        );
        const extractTopics = new ExtractTopicsAndQuestions();
        const commentsEmbedNode = new CommentsEmbedsProcessing();
        youtubeUrl.next(extractTopics).next(commentsEmbedNode);

        const preProccessFlow = new Flow(youtubeUrl);

        const triggerSearchBatch = new SearchBatchNode();
        const topicsSimilaritySearch = new TopicsSimilaritySearch();
        triggerSearchBatch.on("process_one", topicsSimilaritySearch);

        const parallelBatchFlow = new ParallelFlow(triggerSearchBatch, {
            maxVisits: 5000000,
        });

        preProccessFlow.next(parallelBatchFlow);

        // Create the master flow, starting with the paymentFlow
        const masterPipeline = new Flow(preProccessFlow);

        const memory: MyGlobal = {
            db: await Database.create(),
        };
        await masterPipeline.run(memory);
    } catch (error) {
        logger.error`Error: ${error}`;
    }

    console.log("App shutdown");
})();
