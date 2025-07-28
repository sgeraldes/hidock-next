import React from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toast } from '@/components/Toast';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <ErrorBoundary>
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-6 ml-64">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
        <Toast />
      </ErrorBoundary>
    </div>
  );
};