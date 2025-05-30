import {
    DuckDBConnection,
    DuckDBInstance,
    DuckDBMaterializedResult,
    DuckDBTimestampTZValue,
} from "@duckdb/node-api";
import { getLogger } from "@logtape/logtape";
import type { CommentData } from "./comments.dto";
import type { DuckDBResultReader } from "@duckdb/node-api/lib/DuckDBResultReader";

const logger = getLogger(["Dbg", "App", "DB"]);

export class Database {
    connect!: DuckDBConnection;

    // Use an async static method for initialization
    static async create(
        databaseName: string = "my_duckdb.db"
    ): Promise<Database> {
        const instance = await DuckDBInstance.create(databaseName);
        const db = new Database(); // Create instance *after* async operation
        db.connect = await instance.connect();
        await db.connect.run(`
                INSTALL vss;
                LOAD vss;
                SET hnsw_enable_experimental_persistence = true;
            `);

        return db;
    }

    // You could add other methods here to interact with the database, e.g.,
    async queryPost(
        sql: string,
        values: any[]
    ): Promise<DuckDBMaterializedResult> {
        // Example query method
        return await this.connect.run(sql, values);
    }
    async queryGet(sql: string): Promise<DuckDBResultReader> {
        // Example query method
        return await this.connect.runAndReadAll(sql);
    }

    async createTables() {
        try {
            await this.connect.run(`
                INSTALL vss;
                LOAD vss;
                SET hnsw_enable_experimental_persistence = true;
            `);

            await this.connect.run(`
                create table if not exists videos (
                    id              VARCHAR not null PRIMARY KEY,
                    title           VARCHAR,
                    thumbnailUrl    VARCHAR,
                    htmlSummary     VARCHAR,
                );
            `);

            await this.connect.run(`
                create table if not exists comments (
                    commentId       VARCHAR not null PRIMARY KEY,
                    videoId         VARCHAR not null,
                    textDisplay     VARCHAR,
                    parentId        VARCHAR, 
                    likeCount       INTEGER,
                    publishedAt     TIMESTAMPTZ,
                    totalReplyCount INTEGER,
                    FOREIGN KEY (videoId) REFERENCES videos(id)
                );
            `);

            await this.connect.run(`
                create table if not exists transcripts (
                    videoId         VARCHAR not null,
                    original        VARCHAR not null ,
                    summarized      VARCHAR,
                    FOREIGN KEY (videoId) REFERENCES videos(id)
                );
            `);

            await this.connect.run(`
                CREATE TABLE if not exists transcripts_embeddings (
                    id              VARCHAR PRIMARY KEY,
                    videoId         VARCHAR not null,
                    parentId        VARCHAR,             
                    text            VARCHAR,                       
                    embedding       FLOAT[768], 
                    createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (videoId) REFERENCES videos(id)
                );
            `);

            await this.connect.run(`
                CREATE TABLE if not exists comments_embeddings (
                    id              UUID PRIMARY KEY DEFAULT UUID(),
                    videoId         VARCHAR not null,
                    commentId       VARCHAR not null,
                    text            VARCHAR,                       
                    embedding       FLOAT[768],                
                    createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (commentId) REFERENCES comments(commentId),
                    FOREIGN KEY (videoId) REFERENCES videos(id)
                );
            `);
        } catch (error) {
            logger.error`Error Creating Table: ${error}`;
        }
    }

    async insertVideo(
        videoId: string,
        videoTitle: string,
        thumbnailUrl: string
    ) {
        try {
            await this.connect.run(
                `
                insert into videos ( id, title, thumbnailUrl)
                    values (?, ?, ?);
            `,
                [videoId, videoTitle, thumbnailUrl]
            );
        } catch (error) {
            logger.error`Error inserting into the videos table: ${error}`;
        }
    }

    async insertTranscript(videoId: string, originalTranscript: string) {
        try {
            await this.connect.run(
                `
                insert into transcripts (videoId, original)
                    values (?, ?);
            `,
                [videoId, originalTranscript]
            );
        } catch (error) {
            logger.error`Error inserting into the Transcripts table: ${error}`;
        }
    }

    async appendComments(videoId: string, comments: CommentData[]) {
        try {
            const appender = await this.connect.createAppender("comments");

            comments.forEach((com) => {
                const date = new Date(com.publishedAt).getDate();
                appender.appendVarchar(com.id);
                appender.appendVarchar(videoId);
                appender.appendVarchar(com.textDisplay);
                appender.appendVarchar(com.parentId ?? "");
                appender.appendInteger(com.likeCount);
                appender.appendTimestampTZ(
                    new DuckDBTimestampTZValue(BigInt(date))
                );
                appender.appendInteger(com.totalReplyCount ?? 0);
                appender.endRow();
            });

            appender.closeSync();
        } catch (error) {
            logger.error`Error appending comments Table: ${error}`;
        }
    }

    async appendCommentsEmbeddings(videoId: string, comments: CommentData[]) {
        try {
            const appender = await this.connect.createAppender("comments");

            comments.forEach((com) => {
                const date = new Date(com.publishedAt).getDate();
                appender.appendVarchar(com.id);
                appender.appendVarchar(videoId);
                appender.appendVarchar(com.textDisplay);
                appender.appendVarchar(com.parentId ?? "");
                appender.appendInteger(com.likeCount);
                appender.appendTimestampTZ(
                    new DuckDBTimestampTZValue(BigInt(date))
                );
                appender.appendInteger(com.totalReplyCount ?? 0);
                appender.endRow();
            });

            appender.closeSync();
        } catch (error) {
            logger.error`Error appending comments Table: ${error}`;
        }
    }

    close() {
        this.connect.closeSync();
    }
}
