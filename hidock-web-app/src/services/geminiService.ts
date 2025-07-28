import { ERROR_MESSAGES, GEMINI_MODELS } from '@/constants';
import type { InsightData, TranscriptionResult } from '@/types';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface TranscriptionProgress {
  stage: 'uploading' | 'processing' | 'analyzing' | 'complete';
  progress: number; // 0-100
  message: string;
}

export interface CancellationToken {
  cancelled: boolean;
  cancel: () => void;
}

class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;
  private apiKey: string = '';
  private activeRequests: Map<string, AbortController> = new Map();

  initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(ERROR_MESSAGES.API_KEY_MISSING);
    }

    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  isInitialized(): boolean {
    return this.genAI !== null && this.apiKey !== '';
  }

  createCancellationToken(): CancellationToken {
    const token = {
      cancelled: false,
      cancel: () => {
        token.cancelled = true;
      }
    };
    return token;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async transcribeAudio(
    audioBase64: string,
    mimeType: string,
    prompt: string = "Transcribe the following audio. Provide the spoken text as accurately as possible.",
    onProgress?: (progress: TranscriptionProgress) => void,
    cancellationToken?: CancellationToken
  ): Promise<TranscriptionResult> {
    if (!this.genAI) {
      throw new Error(ERROR_MESSAGES.API_KEY_MISSING);
    }

    const requestId = this.generateRequestId();
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      // Check for cancellation
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      onProgress?.({
        stage: 'uploading',
        progress: 10,
        message: 'Preparing audio for transcription...'
      });

      const model = this.genAI.getGenerativeModel({ model: GEMINI_MODELS.AUDIO });

      onProgress?.({
        stage: 'processing',
        progress: 30,
        message: 'Sending audio to Gemini AI...'
      });

      // Check for cancellation before making request
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const result = await model.generateContent([
        {
          inlineData: {
            data: audioBase64,
            mimeType: mimeType,
          },
        },
        prompt,
      ]);

      onProgress?.({
        stage: 'processing',
        progress: 70,
        message: 'Processing transcription...'
      });

      // Check for cancellation before processing response
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const response = result.response;
      const text = response.text();

      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: 'Transcription complete!'
      });

      return {
        text: text.trim(),
        confidence: 0.95, // Gemini doesn't provide confidence scores
        language: 'auto-detected',
        timestamp: new Date(),
      };
    } catch (error) {
      if (cancellationToken?.cancelled || error instanceof Error && error.message === 'Operation cancelled') {
        console.log('Transcription cancelled by user');
        throw new Error('Transcription cancelled');
      }

      console.error('Transcription error:', error);
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  async extractInsights(
    transcriptionText: string,
    prompt: string = `Analyze the following transcription and extract key discussion points, overall sentiment (Positive, Negative, or Neutral), potential action items, and a concise summary. Format the output as a JSON object with keys: "summary", "keyPoints" (array of strings), "sentiment" (string), and "actionItems" (array of strings).`,
    onProgress?: (progress: TranscriptionProgress) => void,
    cancellationToken?: CancellationToken
  ): Promise<InsightData> {
    if (!this.genAI) {
      throw new Error(ERROR_MESSAGES.API_KEY_MISSING);
    }

    const requestId = this.generateRequestId();
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      // Check for cancellation
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      onProgress?.({
        stage: 'analyzing',
        progress: 10,
        message: 'Preparing text for analysis...'
      });

      const model = this.genAI.getGenerativeModel({ model: GEMINI_MODELS.TEXT });

      onProgress?.({
        stage: 'analyzing',
        progress: 30,
        message: 'Analyzing transcription content...'
      });

      // Check for cancellation before making request
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const result = await model.generateContent([
        prompt,
        `\n\nTranscription:\n${transcriptionText}`
      ]);

      onProgress?.({
        stage: 'analyzing',
        progress: 70,
        message: 'Extracting insights...'
      });

      // Check for cancellation before processing response
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const response = result.response;
      const text = response.text();

      onProgress?.({
        stage: 'analyzing',
        progress: 90,
        message: 'Processing results...'
      });

      // Try to parse as JSON first
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          onProgress?.({
            stage: 'complete',
            progress: 100,
            message: 'Insights extracted successfully!'
          });

          return {
            summary: parsed.summary || 'No summary available',
            keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
            sentiment: ['Positive', 'Negative', 'Neutral'].includes(parsed.sentiment)
              ? parsed.sentiment
              : 'Neutral',
            actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
            topics: Array.isArray(parsed.topics) ? parsed.topics : [],
            speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
          };
        }
      } catch (parseError) {
        console.warn('Failed to parse JSON response, using fallback parsing');
      }

      // Fallback: parse the text manually
      const result_data = this.parseInsightsFromText(text);

      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: 'Insights extracted successfully!'
      });

      return result_data;
    } catch (error) {
      if (cancellationToken?.cancelled || error instanceof Error && error.message === 'Operation cancelled') {
        console.log('Insight extraction cancelled by user');
        throw new Error('Insight extraction cancelled');
      }

      console.error('Insight extraction error:', error);
      throw new Error(`Insight extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  private parseInsightsFromText(text: string): InsightData {
    // Simple text parsing as fallback
    const lines = text.split('\n').filter(line => line.trim());

    let summary = 'Analysis completed';
    const keyPoints: string[] = [];
    const actionItems: string[] = [];
    let sentiment: 'Positive' | 'Negative' | 'Neutral' = 'Neutral';

    // Look for common patterns
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();

      if (lowerLine.includes('summary') || lowerLine.includes('overview')) {
        summary = line.replace(/^[^:]*:?\s*/, '').trim();
      } else if (lowerLine.includes('key point') || lowerLine.includes('main point')) {
        keyPoints.push(line.replace(/^[^:]*:?\s*/, '').trim());
      } else if (lowerLine.includes('action') || lowerLine.includes('todo') || lowerLine.includes('task')) {
        actionItems.push(line.replace(/^[^:]*:?\s*/, '').trim());
      } else if (lowerLine.includes('positive')) {
        sentiment = 'Positive';
      } else if (lowerLine.includes('negative')) {
        sentiment = 'Negative';
      }
    });

    return {
      summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : ['Key insights extracted from transcription'],
      sentiment,
      actionItems: actionItems.length > 0 ? actionItems : [],
      topics: [],
      speakers: [],
    };
  }

  async generateSummary(
    transcriptionText: string,
    onProgress?: (progress: TranscriptionProgress) => void,
    cancellationToken?: CancellationToken
  ): Promise<string> {
    if (!this.genAI) {
      throw new Error(ERROR_MESSAGES.API_KEY_MISSING);
    }

    const requestId = this.generateRequestId();
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      // Check for cancellation
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      onProgress?.({
        stage: 'analyzing',
        progress: 20,
        message: 'Preparing summary generation...'
      });

      const model = this.genAI.getGenerativeModel({ model: GEMINI_MODELS.TEXT });

      onProgress?.({
        stage: 'analyzing',
        progress: 50,
        message: 'Generating summary...'
      });

      // Check for cancellation before making request
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const result = await model.generateContent([
        'Provide a concise summary of the following transcription:',
        transcriptionText
      ]);

      onProgress?.({
        stage: 'analyzing',
        progress: 90,
        message: 'Finalizing summary...'
      });

      // Check for cancellation before processing response
      if (cancellationToken?.cancelled) {
        throw new Error('Operation cancelled');
      }

      const response = result.response;
      const summary = response.text().trim();

      onProgress?.({
        stage: 'complete',
        progress: 100,
        message: 'Summary generated successfully!'
      });

      return summary;
    } catch (error) {
      if (cancellationToken?.cancelled || error instanceof Error && error.message === 'Operation cancelled') {
        console.log('Summary generation cancelled by user');
        throw new Error('Summary generation cancelled');
      }

      console.error('Summary generation error:', error);
      throw new Error(`Summary generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  // Method to cancel all active requests
  cancelAllRequests(): void {
    this.activeRequests.forEach((controller) => {
      controller.abort();
    });
    this.activeRequests.clear();
  }

  // Method to cancel a specific request
  cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }
}

export const geminiService = new GeminiService();