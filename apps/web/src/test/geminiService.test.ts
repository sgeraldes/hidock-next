import { ERROR_MESSAGES } from '@/constants';
import { geminiService } from '@/services/geminiService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Type for accessing internal gemini service properties in tests
interface TestableGeminiService {
    genAI: unknown;
    activeRequests: Map<string, AbortController>;
}

// Mock the Google Generative AI
vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn()
        })
    }))
}));

describe('GeminiService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Reset the service state
        geminiService.cancelAllRequests();
    });

    describe('initialization', () => {
        it('should initialize with valid API key', () => {
            expect(() => geminiService.initialize('valid-api-key')).not.toThrow();
            expect(geminiService.isInitialized()).toBe(true);
        });

        it('should throw error with empty API key', () => {
            expect(() => geminiService.initialize('')).toThrow(ERROR_MESSAGES.API_KEY_MISSING);
            expect(() => geminiService.initialize('   ')).toThrow(ERROR_MESSAGES.API_KEY_MISSING);
        });

        it('should throw error with null/undefined API key', () => {
            expect(() => geminiService.initialize(null as unknown as string)).toThrow(ERROR_MESSAGES.API_KEY_MISSING);
            expect(() => geminiService.initialize(undefined as unknown as string)).toThrow(ERROR_MESSAGES.API_KEY_MISSING);
        });
    });

    describe('cancellation token', () => {
        it('should create cancellation token', () => {
            const token = geminiService.createCancellationToken();
            expect(token.cancelled).toBe(false);
            expect(typeof token.cancel).toBe('function');
        });

        it('should cancel token when cancel is called', () => {
            const token = geminiService.createCancellationToken();
            token.cancel();
            expect(token.cancelled).toBe(true);
        });
    });

    describe('transcribeAudio', () => {
        beforeEach(() => {
            geminiService.initialize('test-api-key');
        });

        it('should throw error when not initialized', async () => {
            const uninitializedService = Object.create(Object.getPrototypeOf(geminiService));
            uninitializedService.genAI = null;
            uninitializedService.apiKey = '';

            await expect(
                uninitializedService.transcribeAudio('base64data', 'audio/wav')
            ).rejects.toThrow(ERROR_MESSAGES.API_KEY_MISSING);
        });

        it('should call progress callback during transcription', async () => {
            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => 'Transcribed text'
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            // Mock the private genAI property
            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const progressCallback = vi.fn();

            await geminiService.transcribeAudio(
                'base64data',
                'audio/wav',
                'Custom prompt',
                progressCallback
            );

            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'uploading',
                progress: 10,
                message: 'Preparing audio for transcription...'
            });

            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'processing',
                progress: 30,
                message: 'Sending audio to Gemini AI...'
            });

            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'complete',
                progress: 100,
                message: 'Transcription complete!'
            });
        });

        it('should handle cancellation during transcription', async () => {
            const token = geminiService.createCancellationToken();
            token.cancel(); // Cancel immediately

            await expect(
                geminiService.transcribeAudio('base64data', 'audio/wav', 'prompt', undefined, token)
            ).rejects.toThrow('Transcription cancelled');
        });

        it('should return transcription result', async () => {
            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => '  Transcribed text content  '
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const result = await geminiService.transcribeAudio('base64data', 'audio/wav');

            expect(result).toEqual({
                text: 'Transcribed text content',
                confidence: 0.95,
                language: 'auto-detected',
                timestamp: expect.any(Date)
            });
        });
    });

    describe('extractInsights', () => {
        beforeEach(() => {
            geminiService.initialize('test-api-key');
        });

        it('should parse JSON response correctly', async () => {
            const mockJsonResponse = JSON.stringify({
                summary: 'Test summary',
                keyPoints: ['Point 1', 'Point 2'],
                sentiment: 'Positive',
                actionItems: ['Action 1'],
                topics: ['Topic 1'],
                speakers: ['Speaker 1']
            });

            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => `Here is the analysis: ${mockJsonResponse}`
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const result = await geminiService.extractInsights('Test transcription');

            expect(result).toEqual({
                summary: 'Test summary',
                keyPoints: ['Point 1', 'Point 2'],
                sentiment: 'Positive',
                actionItems: ['Action 1'],
                topics: ['Topic 1'],
                speakers: ['Speaker 1']
            });
        });

        it('should use fallback parsing when JSON parsing fails', async () => {
            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => `Summary: This is a summary
Key point: Important point
Action: Do something
Sentiment: positive`
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const result = await geminiService.extractInsights('Test transcription');

            expect(result.summary).toContain('This is a summary');
            expect(result.keyPoints).toContain('Important point');
            expect(result.actionItems).toContain('Do something');
            expect(result.sentiment).toBe('Positive');
        });

        it('should call progress callback during insight extraction', async () => {
            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => '{"summary": "test"}'
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const progressCallback = vi.fn();

            await geminiService.extractInsights(
                'Test transcription',
                'Custom prompt',
                progressCallback
            );

            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'analyzing',
                progress: 10,
                message: 'Preparing text for analysis...'
            });

            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'complete',
                progress: 100,
                message: 'Insights extracted successfully!'
            });
        });

        it('should handle cancellation during insight extraction', async () => {
            const token = geminiService.createCancellationToken();
            token.cancel();

            await expect(
                geminiService.extractInsights('text', 'prompt', undefined, token)
            ).rejects.toThrow('Insight extraction cancelled');
        });
    });

    describe('generateSummary', () => {
        beforeEach(() => {
            geminiService.initialize('test-api-key');
        });

        it('should generate summary with progress tracking', async () => {
            const mockModel = {
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () => '  Generated summary  '
                    }
                })
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            const progressCallback = vi.fn();

            const result = await geminiService.generateSummary(
                'Test transcription',
                progressCallback
            );

            expect(result).toBe('Generated summary');
            expect(progressCallback).toHaveBeenCalledWith({
                stage: 'analyzing',
                progress: 20,
                message: 'Preparing summary generation...'
            });
        });

        it('should handle cancellation during summary generation', async () => {
            const token = geminiService.createCancellationToken();
            token.cancel();

            await expect(
                geminiService.generateSummary('text', undefined, token)
            ).rejects.toThrow('Summary generation cancelled');
        });
    });

    describe('request management', () => {
        beforeEach(() => {
            geminiService.initialize('test-api-key');
        });

        it('should track active requests', async () => {
            const mockModel = {
                generateContent: vi.fn().mockImplementation(() =>
                    new Promise(resolve => setTimeout(resolve, 100))
                )
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            // Start a request but don't wait for it
            const promise = geminiService.transcribeAudio('base64data', 'audio/wav');

            // Check that request is tracked
            expect((geminiService as unknown as TestableGeminiService).activeRequests.size).toBe(1);

            // Wait for completion
            await promise.catch(() => { }); // Ignore errors for this test

            // Check that request is cleaned up
            expect((geminiService as unknown as TestableGeminiService).activeRequests.size).toBe(0);
        });

        it('should cancel all requests', () => {
            // Add some mock requests
            const controller1 = new AbortController();
            const controller2 = new AbortController();

            (geminiService as unknown as TestableGeminiService).activeRequests.set('req1', controller1);
            (geminiService as unknown as TestableGeminiService).activeRequests.set('req2', controller2);

            const abortSpy1 = vi.spyOn(controller1, 'abort');
            const abortSpy2 = vi.spyOn(controller2, 'abort');

            geminiService.cancelAllRequests();

            expect(abortSpy1).toHaveBeenCalled();
            expect(abortSpy2).toHaveBeenCalled();
            expect((geminiService as unknown as TestableGeminiService).activeRequests.size).toBe(0);
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            geminiService.initialize('test-api-key');
        });

        it('should handle API errors gracefully', async () => {
            const mockModel = {
                generateContent: vi.fn().mockRejectedValue(new Error('API Error'))
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            await expect(
                geminiService.transcribeAudio('base64data', 'audio/wav')
            ).rejects.toThrow('Transcription failed: API Error');
        });

        it('should handle unknown errors', async () => {
            const mockModel = {
                generateContent: vi.fn().mockRejectedValue('Unknown error')
            };

            const mockGenAI = {
                getGenerativeModel: vi.fn().mockReturnValue(mockModel)
            };

            (geminiService as unknown as TestableGeminiService).genAI = mockGenAI;

            await expect(
                geminiService.transcribeAudio('base64data', 'audio/wav')
            ).rejects.toThrow('Transcription failed: Unknown error');
        });
    });
});
