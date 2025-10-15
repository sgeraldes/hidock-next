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
        <div className="flex pt-16">
          <Sidebar />
          <main className="flex-1 px-3 sm:px-6 py-6 md:ml-16 xl:ml-64 h-[calc(100vh-4rem)]">
            <div className="h-full overflow-y-auto">
              {children}
            </div>
          </main>
        </div>
        <Toast />
      </ErrorBoundary>
    </div>
  );
};
