export interface AuthorChannelId {
    value: string;
}

export interface CommentSnippet {
    authorDisplayName: string;
    authorProfileImageUrl: string;
    authorChannelUrl: string;
    authorChannelId: AuthorChannelId;
    channelId: string;
    textDisplay: string;
    textOriginal: string;
    parentId?: string; // Optional parentId for replies
    canRate: boolean;
    viewerRating: string;
    likeCount: number;
    moderationStatus: string;
    publishedAt: string; // datetime string
    updatedAt: string; // datetime string
}

export interface Comment {
    kind: string;
    etag: string;
    id: string;
    snippet: CommentSnippet;
}

export interface CommentThreadSnippet {
    channelId: string;
    videoId: string;
    topLevelComment: Comment;
    canReply: boolean;
    totalReplyCount: number;
    isPublic: boolean;
}

export interface CommentThreadReplies {
    comments: Comment[];
}

export interface CommentThread {
    kind: string;
    etag: string;
    id: string;
    snippet: CommentThreadSnippet;
    replies?: CommentThreadReplies; // Replies are optional
}

export interface CommentThreadList {
    kind?: string | null;
    etag?: string | null;
    nextPageToken?: string | null;
    pageInfo?: {
        totalResults: number;
        resultsPerPage: number;
    } | null;
    items: CommentThread[];
}

export interface CommentData {
    id: string;
    textDisplay: string;
    parentId?: string;
    likeCount: number;
    publishedAt: string;
    totalReplyCount?: number; // Optional, as replies won't have this.
}

export interface YoutubeInfo {
    videoId: string;
    videoTitle: string;
    transcript: string;
    comments: CommentData[];
    thumbnailUrl: string;
}

export function extractCommentData(
    commentThreadList: CommentThreadList
): CommentData[] {
    const extractedData: CommentData[] = [];

    for (const item of commentThreadList.items) {
        const topLevelComment = item.snippet.topLevelComment;

        extractedData.push({
            id: topLevelComment.id,
            textDisplay: topLevelComment.snippet.textDisplay,
            parentId: topLevelComment.snippet.parentId,
            likeCount: topLevelComment.snippet.likeCount,
            publishedAt: topLevelComment.snippet.publishedAt,
            totalReplyCount: item.snippet.totalReplyCount,
        });
        if (item.replies) {
            for (const reply of item.replies.comments) {
                extractedData.push({
                    id: reply.id,
                    textDisplay: reply.snippet.textDisplay,
                    parentId: reply.snippet.parentId,
                    likeCount: reply.snippet.likeCount,
                    publishedAt: reply.snippet.publishedAt,
                    totalReplyCount: undefined, //Replies do not have reply count
                });
            }
        }
    }

    return extractedData;
}
