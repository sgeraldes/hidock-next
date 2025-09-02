
import React, { useState, useCallback, useEffect } from 'react';
import { AudioInput } from './components/AudioInput';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { InsightsDisplay } from './components/InsightsDisplay';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorMessage } from './components/ErrorMessage';
import { transcribeAudioWithGemini, extractInsightsFromText } from './services/geminiService';
import type { AudioData, InsightData } from './types';
import { GEMINI_MODELS } from './constants';
import { BrainCircuitIcon, FileAudioIcon, LightbulbIcon, AlertTriangleIcon } from './components/IconComponents';


type AppStep = 'initial' | 'audio_ready' | 'transcribing' | 'transcribed' | 'analyzing' | 'analyzed' | 'error';

const App: React.FC = () => {
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightData | null>(null);
  const [currentStep, setCurrentStep] = useState<AppStep>('initial');
  const [error, setError] = useState<string | null>(null);
  const [apiKeyExists, setApiKeyExists] = useState<boolean>(false);


  useEffect(() => {
    // This is a proxy for checking if the API key might be configured.
    // In a real scenario, process.env.API_KEY is a build-time substitution or server-side variable.
    // For client-side checks like this, it's tricky. We'll assume if it's not an empty string, it's "set".
    if (process.env.API_KEY && process.env.API_KEY.trim() !== '') {
      setApiKeyExists(true);
    } else {
      setError("Gemini API Key is not configured. Please set the API_KEY environment variable.");
      setCurrentStep('error');
    }
  }, []);

  const handleAudioReady = useCallback((data: AudioData) => {
    setAudioData(data);
    setCurrentStep('audio_ready');
    setTranscription(null);
    setInsights(null);
    setError(null);
  }, []);

  const handleTranscription = useCallback(async () => {
    if (!audioData) {
      setError("No audio data available to transcribe.");
      setCurrentStep('error');
      return;
    }
    setCurrentStep('transcribing');
    setError(null);
    try {
      const transcript = await transcribeAudioWithGemini(audioData.base64, audioData.mimeType, "Transcribe the following audio. Provide the spoken text as accurately as possible.");
      setTranscription(transcript);
      setCurrentStep('transcribed');
    } catch (err) {
      console.error("Transcription error:", err);
      setError(err instanceof Error ? err.message : "Failed to transcribe audio. Check console for details.");
      setCurrentStep('error');
    }
  }, [audioData]);

  const handleInsightExtraction = useCallback(async () => {
    if (!transcription) {
      setError("No transcription available to analyze.");
      setCurrentStep('error');
      return;
    }
    setCurrentStep('analyzing');
    setError(null);
    try {
      const insightData = await extractInsightsFromText(transcription, `Analyze the following transcription and extract key discussion points, overall sentiment (Positive, Negative, or Neutral), potential action items, and a concise summary. Format the output as a JSON object with keys: "summary", "keyPoints" (array of strings), "sentiment" (string), and "actionItems" (array of strings).`);
      setInsights(insightData);
      setCurrentStep('analyzed');
    } catch (err) {
      console.error("Insight extraction error:", err);
      setError(err instanceof Error ? err.message : "Failed to extract insights. Check console for details.");
      setCurrentStep('error');
    }
  }, [transcription]);

  const resetApp = () => {
    setAudioData(null);
    setTranscription(null);
    setInsights(null);
    setCurrentStep('initial');
    setError(null);
  };

  if (!apiKeyExists && currentStep === 'error') {
     return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-100">
        <div className="bg-white p-8 rounded-xl shadow-2xl max-w-lg w-full text-center">
          <AlertTriangleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Configuration Error</h1>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 py-8 px-4 flex flex-col items-center text-slate-100">
      <header className="mb-10 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-rose-400 to-lime-400">
          Audio Insights Extractor
        </h1>
        <p className="mt-3 text-lg text-slate-400">
          Upload or record audio, get transcriptions, and extract valuable insights powered by Gemini ({GEMINI_MODELS.TEXT}).
        </p>
      </header>

      <main className="w-full max-w-3xl space-y-8">
        {error && currentStep === 'error' && (
            <ErrorMessage message={error} onClear={() => setError(null)} />
        )}

        {/* Step 1: Audio Input */}
        <section className="bg-slate-800 p-6 rounded-xl shadow-xl transition-all duration-500 ease-in-out">
          <div className="flex items-center mb-4">
            <FileAudioIcon className="w-8 h-8 text-sky-400 mr-3" />
            <h2 className="text-2xl font-semibold text-sky-300">1. Provide Audio</h2>
          </div>
          {currentStep !== 'transcribing' && currentStep !== 'analyzing' && (
            // If AudioInput is rendered, it means currentStep is not 'transcribing' or 'analyzing'.
            // Thus, the original `disabled={currentStep === 'transcribing' || currentStep === 'analyzing'}`
            // would always evaluate to `disabled={false}`.
            <AudioInput onAudioReady={handleAudioReady} disabled={false} />
          )}
          {audioData && (currentStep === 'audio_ready' || currentStep === 'transcribed' || currentStep === 'analyzed' || currentStep === 'error') && (
            <div className="mt-4 p-3 bg-slate-700 rounded-lg">
              <p className="text-sm text-slate-300">File: <span className="font-medium text-slate-100">{audioData.fileName}</span> ({audioData.mimeType})</p>
            </div>
          )}
           {(currentStep === 'transcribing' || currentStep === 'analyzing') && <LoadingSpinner text={currentStep === 'transcribing' ? "Transcribing audio..." : "Analyzing insights..."} />}
        </section>

        {/* Transcribe Button - Shown when audio is ready */}
        {currentStep === 'audio_ready' && audioData && (
          <button
            onClick={handleTranscription}
            // If this button is rendered, currentStep is 'audio_ready'.
            // Thus, the original `disabled={currentStep === 'transcribing'}`
            // would always evaluate to `disabled={false}`.
            disabled={false}
            className="w-full flex items-center justify-center bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:shadow-lg transition duration-300 ease-in-out disabled:opacity-50"
          >
            <BrainCircuitIcon className="w-5 h-5 mr-2" />
            Transcribe Audio
          </button>
        )}

        {/* Step 2: Transcription */}
        {(currentStep === 'transcribed' || currentStep === 'analyzing' || currentStep === 'analyzed') && transcription && (
          <section className="bg-slate-800 p-6 rounded-xl shadow-xl transition-all duration-500 ease-in-out">
            <div className="flex items-center mb-4">
              <BrainCircuitIcon className="w-8 h-8 text-rose-400 mr-3" />
              <h2 className="text-2xl font-semibold text-rose-300">2. Transcription</h2>
            </div>
            <TranscriptionDisplay text={transcription} />
            {currentStep === 'transcribed' && (
              <button
                onClick={handleInsightExtraction}
                // If this button is rendered, currentStep is 'transcribed'.
                // Thus, the original `disabled={currentStep === 'analyzing'}`
                // would always evaluate to `disabled={false}`.
                disabled={false}
                className="mt-4 w-full flex items-center justify-center bg-rose-500 hover:bg-rose-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:shadow-lg transition duration-300 ease-in-out disabled:opacity-50"
              >
                <LightbulbIcon className="w-5 h-5 mr-2" />
                Extract Insights
              </button>
            )}
          </section>
        )}

        {/* Step 3: Insights */}
        {currentStep === 'analyzed' && insights && (
           <section className="bg-slate-800 p-6 rounded-xl shadow-xl transition-all duration-500 ease-in-out">
            <div className="flex items-center mb-4">
              <LightbulbIcon className="w-8 h-8 text-lime-400 mr-3" />
              <h2 className="text-2xl font-semibold text-lime-300">3. Insights</h2>
            </div>
            <InsightsDisplay insights={insights} />
          </section>
        )}

        {/* Reset Button - Shown if something has been processed or an error occurred */}
        {(currentStep !== 'initial' && currentStep !== 'audio_ready') && (
           <button
            onClick={resetApp}
            className="w-full mt-8 bg-slate-600 hover:bg-slate-500 text-slate-100 font-semibold py-3 px-6 rounded-lg shadow-md hover:shadow-lg transition duration-300 ease-in-out"
          >
            Start Over
          </button>
        )}

      </main>
      <footer className="mt-12 text-center text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Audio Insights Extractor. Powered by Gemini.</p>
      </footer>
    </div>
  );
};

export default App;
