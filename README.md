# yt_comments_sentiments

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run ./src/main.ts
```

This project was created using `bun init` in bun v1.2.2. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

Get a youtube video and extract the transcript and comments. Summarize the transcript into topics using LLM(Gemini). Get the sentiments of the comments based on the topics using an LLM( Gemini).

# High-Level Flow Diagram;

```
                    +------------------------+
                    | YouTube Video URL |
                    +------------------------+
                                |
                                v
                    +------------------------+ (API Request)
                    | Backend API Layer |
                    +------------------------+
                                |
                                v
                    +------------------------+
                    | Data Extraction | <-- (Transcript & Comments)
                    +------------------------+
                                |
                                v
                    +------------------------+
                    | Data Preprocessing | <-- (Clean and Normalize)
                    +------------------------+
                                |
                                v
                    +------------------------------------------+
                    | LLM Processing Module |
                    | ------------------------------ |
                    | 1. Transcript Summarization (Topics) |
                    | 2. Comment Sentiment Analysis (by Topic) |
                    +------------------------------------------+
                                |
                                v
                    +------------------------+
                    | Persistence & Caching |
                    +------------------------+
                                |
                                v
                    +------------------------+
                    | Visualization/UI |
                    +------------------------+
```
