import { Supadata, SupadataError, type Transcript } from "@supadata/js";

// Get YouTube transcript
export async function getYoutubeTranscript(
    videoId: string
): Promise<Transcript> {
    try {
        const supadata = new Supadata({
            apiKey: Bun.env.SUPADATA_KEY!,
        });

        const transcript: Transcript = await supadata.youtube.transcript({
            videoId,
            text: true,
        });

        return transcript;
    } catch (e) {
        if (e instanceof SupadataError) {
            console.error(e.error); // e.g., 'video-not-found'
            console.error(e.message); // Human readable error message
            console.error(e.details); // Detailed error description
            console.error(e.documentationUrl); // Link to error documentation (optional)
        }

        throw e;
    }
}
