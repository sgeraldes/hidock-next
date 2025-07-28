import React, { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Recordings } from '@/pages/Recordings';
import { Transcription } from '@/pages/Transcription';
import { Settings } from '@/pages/Settings';
import { useAppStore } from '@/store/useAppStore';
import { geminiService } from '@/services/geminiService';

function App() {
  const { settings, setError } = useAppStore();

  useEffect(() => {
    // Initialize Gemini service if API key is available
    if (settings.geminiApiKey) {
      try {
        geminiService.initialize(settings.geminiApiKey);
      } catch (error) {
        console.error('Failed to initialize Gemini service:', error);
        // Temporarily comment out to avoid blocking the app
        // setError(error instanceof Error ? error.message : 'Failed to initialize AI service');
      }
    }
  }, [settings.geminiApiKey, setError]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/recordings" element={<Recordings />} />
        <Route path="/transcription" element={<Transcription />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

export default App;