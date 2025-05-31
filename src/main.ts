import {
    configure,
    getConsoleSink,
    getAnsiColorFormatter,
    withFilter,
    getLogger,
} from "@logtape/logtape";
import { getFileSink } from "@logtape/file";
import {
    CommentsEmbedsProcessing,
    ContentBatch,
    ExtractTopicsAndQuestions,
    GenerateHTML,
    ProcessContent,
    ProcessYoutubeURL,
    testNode,
    type MyGlobal,
} from "./flow";
import { DEFAULT_ACTION, Flow, ParallelFlow } from "./pocket";
import { Database } from "./utils/database";
import { PostVss, SearchBatchNode, TopicsSimilaritySearch } from "./vssNodes";

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
        const memory: MyGlobal = {
            db,
            summary: false,
        };

        const youtubeUrl = new ProcessYoutubeURL(
            // "https://www.youtube.com/watch?v=bNdr10pE_20"
            "https://www.youtube.com/watch?v=Lfr2KvIS2nY"
            // "https://www.youtube.com/watch?v=mgoCr7STbh4"
        );
        const extractTopics = new ExtractTopicsAndQuestions();
        const commentsEmbedNode = new CommentsEmbedsProcessing();
        const summarizedNode = new testNode();
        youtubeUrl.next(extractTopics, DEFAULT_ACTION).next(commentsEmbedNode);
        youtubeUrl.next(summarizedNode, "summarized");

        const preProccessFlow = new Flow<MyGlobal, ["default", "summarized"]>(
            youtubeUrl
        );

        // * Similarity Search Flow
        const triggerSearchBatch = new SearchBatchNode();
        const topicsSimilaritySearch = new TopicsSimilaritySearch();
        const postVss = new PostVss();
        triggerSearchBatch.on("process_one", topicsSimilaritySearch);

        const similarityFlow = new ParallelFlow(triggerSearchBatch, {
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
        preProccessFlow.on(DEFAULT_ACTION, contentBatchFlow);
        preProccessFlow.on("summarized", similarityFlow);
        contentBatchFlow.next(postProccessFlow);
        similarityFlow.next(new Flow(postVss));
        // parallelBatchFlow.next(contentBatchFlow);

        // Create the master flow, starting with the paymentFlow
        const masterPipeline = new Flow(preProccessFlow);

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const triggers = await masterPipeline.run(memory);
        // logger.debug`Triggers opp: ${JSON.stringify(triggers)}`;

        db.close();
    } catch (error) {
        db.close();
        logger.error`Error: ${error}`;
        //TODO YAMLParseError is same as llm response error
    }

    console.log("App shutdown");
})();
