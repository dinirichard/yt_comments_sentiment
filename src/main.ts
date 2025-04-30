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
    CommentsProcessing,
    ProcessYoutubeURL,
    SearchBatchNode,
    TopicsSimilaritySearch,
} from "./flow";
import { Flow, ParallelFlow } from "./pocket";
import type { Database } from "./database";

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
        interface MyGlobal {
            youtubeInfo?: object;
            videoId?: string;
            db?: Database;
            pathSpecificData?: string;
            topics?: string;
        }

        const youtube = new ProcessYoutubeURL(
            "https://www.youtube.com/watch?v=mgoCr7STbh4"
        );
        // const yaml = new ExtractTopicsAndQuestions();
        const commentsNode = new CommentsProcessing();
        youtube.next(commentsNode);

        const preProccessFlow = new Flow(youtube);

        const triggerSearchBatch = new SearchBatchNode();
        const topicsSimilaritySearch = new TopicsSimilaritySearch();
        triggerSearchBatch.on("process_one", topicsSimilaritySearch);

        const parallelBatchFlow = new ParallelFlow<MyGlobal>(
            triggerSearchBatch
        );
        preProccessFlow.next(parallelBatchFlow);

        const memory: MyGlobal = {};
        await preProccessFlow.run(memory);
    } catch (error) {
        logger.error`Error: ${error}`;
    }

    console.log("App shutdown");
})();
