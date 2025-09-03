
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GEMINI_MODELS } from '../constants';
import type { InsightData } from '../types';

// IMPORTANT: API Key is expected to be in process.env.API_KEY
// This will be set in the environment where the code runs.
// const API_KEY = process.env.REACT_APP_GEMINI_API_KEY; // Example for CRA/Vite, adjust as needed
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("Gemini API Key not found. Please set the API_KEY environment variable.");
  // Throwing an error here might be too disruptive if the UI wants to handle it.
  // The App.tsx component can check for this and display a more user-friendly message.
}

const ai = new GoogleGenAI({ apiKey: API_KEY! }); // The '!' asserts API_KEY is non-null, App.tsx should guard this.

// Define local types for content parts, as ContentPart or similar is not directly exported by @google/genai in a way that's typically used.
// This represents the structure of an inline data part for images or audio.
interface GeminiInlineData {
  mimeType: string;
  data: string;
}

// This represents a text part.
// interface GeminiTextPart { // Not strictly needed as a separate interface if using discriminated union below
//   text: string;
// }

// This discriminated union type represents a single part of the content sent to Gemini.
// It's equivalent to the non-exported 'Part' type within the @google/genai SDK.
type GeminiPart =
  | { inlineData: GeminiInlineData; text?: never; } // A part with inline data (e.g., audio, image)
  | { text: string; inlineData?: never; };          // A part with text

/**
 * "Transcribes" audio using Gemini's multimodal capabilities.
 * Note: Gemini's general models are not specialized speech-to-text engines.
 * Quality may vary. For high-accuracy transcription, a dedicated STT service is usually better.
 */
export const transcribeAudioWithGemini = async (
  audioBase64: string,
  mimeType: string,
  promptText: string = "Transcribe this audio recording."
): Promise<string> => {
  if (!API_KEY) throw new Error("Gemini API Key is not configured.");

  const audioPart: GeminiPart = {
    inlineData: {
      mimeType: mimeType,
      data: audioBase64,
    },
  };

  const textPart: GeminiPart = {
    text: promptText,
  };

  try {
    // The 'contents' field for generateContent, when providing multimodal input like this,
    // takes an object with a 'parts' array. Each element in 'parts' is a GeminiPart.
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT, // multimodal model
      contents: { parts: [audioPart, textPart] },
    });
    return response.text;
  } catch (error) {
    console.error("Error transcribing audio with Gemini:", error);
    if (error instanceof Error) {
        // Check for specific Gemini API error messages if available
        // For example, if error.message contains details about unsupported audio or quota issues.
        throw new Error(`Gemini API error during transcription: ${error.message}`);
    }
    throw new Error("An unknown error occurred during audio transcription with Gemini.");
  }
};

/**
 * Extracts insights from text using Gemini.
 * Expects Gemini to return a JSON string based on the prompt.
 */
export const extractInsightsFromText = async (
  text: string,
  promptText: string = "Extract key insights from the following text. Format as JSON: { summary: string, keyPoints: string[], sentiment: string, actionItems: string[] }"
): Promise<InsightData> => {
  if (!API_KEY) throw new Error("Gemini API Key is not configured.");

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODELS.TEXT,
      contents: `${promptText}\n\nText:\n${text}`,
      config: {
        responseMimeType: "application/json",
      }
    });

    let jsonStr = response.text.trim();

    // Remove Markdown code fences if present
    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
    const match = jsonStr.match(fenceRegex);
    if (match && match[2]) {
      jsonStr = match[2].trim();
    }

    try {
      const parsedData = JSON.parse(jsonStr);
      // Basic validation of the parsed structure
      if (parsedData && typeof parsedData.summary === 'string' && Array.isArray(parsedData.keyPoints) && typeof parsedData.sentiment === 'string' && Array.isArray(parsedData.actionItems)) {
        return parsedData as InsightData;
      } else {
        console.warn("Parsed JSON does not match expected InsightData structure:", parsedData);
        // throw new Error("Received malformed insight data from API. Attempting to provide raw text.");
        // Return a structured error or a default InsightData object with the raw text in summary, as per original logic
         return {
          summary: `Could not parse insights. API returned malformed data. Raw response: ${response.text}`,
          keyPoints: [],
          sentiment: "Unknown",
          actionItems: []
        };
      }
    } catch (parseError) {
      console.error("Failed to parse JSON response from Gemini for insights:", parseError);
      console.log("Raw Gemini text for insights:", response.text);
      // Fallback: try to return a structured error or a default InsightData object with the raw text in summary
      return {
        summary: `Could not parse insights. Raw API response: ${response.text}`,
        keyPoints: [],
        sentiment: "Unknown",
        actionItems: []
      };
    }
  } catch (error) {
    console.error("Error extracting insights with Gemini:", error);
     if (error instanceof Error) {
        throw new Error(`Gemini API error during insight extraction: ${error.message}`);
    }
    throw new Error("An unknown error occurred during insight extraction with Gemini.");
  }
};
