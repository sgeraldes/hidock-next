
import React from 'react';

interface TranscriptionDisplayProps {
  text: string | null;
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ text }) => {
  if (!text) {
    return null;
  }

  return (
    <div className="mt-4 p-4 bg-slate-700 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-slate-200 mb-2">Transcription:</h3>
      <pre className="whitespace-pre-wrap break-words text-slate-300 text-sm leading-relaxed h-64 overflow-y-auto p-3 bg-slate-900/50 rounded-md">
        {text}
      </pre>
    </div>
  );
};
