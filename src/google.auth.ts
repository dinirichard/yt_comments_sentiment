import { google, youtube_v3 } from "googleapis";
import * as fs from "fs";
import {
    extractCommentData,
    type CommentData,
    type CommentThreadList,
    type YoutubeInfo,
} from "./comments.dto";
import { getLogger } from "@logtape/logtape";
import { getYoutubeTranscript } from "./transcript";

const logger = getLogger(["Dbg", "App", "Auth"]);

export async function getYoutubeInfo(videoId: string) {
    try {
        const youtube = await getAuthenticatedYoutube();

        const videoDetails = await getVideoDetails(youtube, videoId);

        // if (videoDetails.caption === "false") {
        //     logger.error`This video has no transcript, quiting program.`;
        //     process.exit(1);
        // }

        const transcript = await getYoutubeTranscript(videoId);

        let commentThreads: CommentThreadList = await getCommentsThreads(
            youtube,
            videoId
        );

        const commentData: CommentData[] = [];
        commentData.push(...extractCommentData(commentThreads));

        while (commentThreads.nextPageToken) {
            commentThreads = await getCommentsThreads(youtube, videoId, {
                nextPageToken: commentThreads.nextPageToken,
            });
            commentData.push(...extractCommentData(commentThreads));
        }
        logger.debug`Comment Data length: ${commentData.length}`;
        // logger.debug`${commentThreads.items[0].snippet}`;

        return {
            videoId,
            videoTitle: videoDetails.videoTitle,
            comments: commentData,
            transcript: transcript.content,
            thumbnailUrl: videoDetails.thumbnailUrl,
        } as YoutubeInfo;
    } catch (error) {
        logger.error`Authentication failed: ${error}`;
        process.exit(1);
    }
}

async function getAuthenticatedYoutube(): Promise<youtube_v3.Youtube> {
    const scopes = [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
    ]; // Add your required scopes

    try {
        const keyFile = Bun.env.SERVICE_JSON!;
        if (!fs.existsSync(keyFile)) {
            logger.error`service file does NOT exist at: ${keyFile}`;
            process.exit(1);
        }

        // Manually create a JWT client
        const jwtClient = new google.auth.JWT(
            undefined,
            keyFile,
            undefined, // Use the extracted private key
            scopes,
            undefined
        );

        // Authorize the client
        await jwtClient.authorize();

        google.options({ auth: jwtClient });
        console.log("Authentication with p12 successful");

        const youtube = google.youtube("v3");

        return youtube;
    } catch (error) {
        logger.error`Authentication failed: ${error}`;
        throw error;
    }
}

async function getVideoDetails(youtube: youtube_v3.Youtube, videoId: string) {
    try {
        const response = await youtube.videos.list({
            part: ["snippet", "contentDetails"],
            id: [videoId],
        });

        const importantData = {
            videoTitle: response?.data?.items![0]?.snippet?.title,
            thumbnailUrl:
                response.data?.items![0]?.snippet?.thumbnails?.maxres?.url,
            caption: response.data?.items![0]?.contentDetails?.caption,
        };
        // logger.debug`Video thumbnails: ${response.data?.items![0]?.snippet?.thumbnails}`;
        // logger.debug`Video contentDetails: ${response.data?.items![0]?.contentDetails}`;
        logger.debug`Video Detail: ${importantData}`;

        return importantData;
    } catch (error) {
        logger.error`Error retrieving commentThreads: ${error}`;
        throw error;
    }
}

async function getCommentsThreads(
    youtube: youtube_v3.Youtube,
    videoId: string,
    options?: { nextPageToken: string }
) {
    try {
        if (!options) {
            const response = await youtube.commentThreads.list({
                part: ["snippet", "replies"],
                videoId,
                order: "relevance",
                textFormat: "plainText",
                maxResults: 100,
            });
            return response.data as unknown as CommentThreadList;
        } else {
            const response = await youtube.commentThreads.list({
                part: ["snippet", "replies"],
                videoId,
                pageToken: options.nextPageToken,
                order: "relevance",
                textFormat: "plainText",
                maxResults: 100,
            });
            return response.data as unknown as CommentThreadList;
        }
    } catch (error) {
        logger.error`Error retrieving commentThreads: ${error}`;
        throw error;
    }
}
