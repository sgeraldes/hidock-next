import React, { useEffect } from 'react';
import { X, CheckCircle as _CheckCircle, AlertCircle as _AlertCircle, Info as _Info } from 'lucide-react'; // Future use - toast type icons
import { useAppStore } from '@/store/useAppStore';

export const Toast: React.FC = () => {
  const { error, setError } = useAppStore();

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  if (!error) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 max-w-md">
        <_AlertCircle className="w-5 h-5 flex-shrink-0" />
        <p className="text-sm">{error}</p>
        <button
          onClick={() => setError(null)}
          className="ml-auto hover:bg-red-700 p-1 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
