
import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ text = "Loading...", size = 'md' }) => {
  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-4',
    lg: 'w-16 h-16 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 my-4">
      <div
        className={`animate-spin rounded-full ${sizeClasses[size]} border-sky-400 border-t-transparent`}
        role="status"
        aria-live="polite"
        aria-label={text}
      >
        <span className="sr-only">{text}</span>
      </div>
      {text && <p className="mt-3 text-slate-400 text-sm">{text}</p>}
    </div>
  );
};
