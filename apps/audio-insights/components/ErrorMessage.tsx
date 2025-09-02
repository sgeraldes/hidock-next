
import React from 'react';
import { AlertTriangleIcon, XIcon } from './IconComponents';

interface ErrorMessageProps {
  message: string;
  onClear?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onClear }) => {
  return (
    <div className="bg-red-800/70 border border-red-700 text-red-200 px-4 py-3 rounded-lg relative shadow-md" role="alert">
      <div className="flex items-center">
        <AlertTriangleIcon className="w-6 h-6 mr-3 text-red-300" />
        <div>
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{message}</span>
        </div>
      </div>
      {onClear && (
        <button
          onClick={onClear}
          className="absolute top-0 bottom-0 right-0 px-4 py-3 text-red-300 hover:text-red-100"
          aria-label="Clear error"
        >
          <XIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
