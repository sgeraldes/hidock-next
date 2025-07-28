
import React from 'react';
import type { InsightData } from '../types';

interface InsightsDisplayProps {
  insights: InsightData | null;
}

const InsightItem: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4 p-3 bg-slate-900/50 rounded-md">
    <h4 className="text-md font-semibold text-lime-300 mb-1">{title}</h4>
    {children}
  </div>
);

export const InsightsDisplay: React.FC<InsightsDisplayProps> = ({ insights }) => {
  if (!insights) {
    return null;
  }

  return (
    <div className="mt-4 p-4 bg-slate-700 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-slate-200 mb-3">Insights:</h3>
      
      <InsightItem title="Summary">
        <p className="text-slate-300 text-sm">{insights.summary}</p>
      </InsightItem>

      <InsightItem title="Key Points">
        {insights.keyPoints.length > 0 ? (
          <ul className="list-disc list-inside text-slate-300 text-sm space-y-1">
            {insights.keyPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400 text-sm italic">No key points extracted.</p>
        )}
      </InsightItem>

      <InsightItem title="Sentiment">
        <p className="text-slate-300 text-sm font-medium">{insights.sentiment}</p>
      </InsightItem>

      <InsightItem title="Action Items">
        {insights.actionItems.length > 0 ? (
          <ul className="list-disc list-inside text-slate-300 text-sm space-y-1">
            {insights.actionItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400 text-sm italic">No action items identified.</p>
        )}
      </InsightItem>
    </div>
  );
};
