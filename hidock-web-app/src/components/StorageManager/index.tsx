/**
 * Storage Management Component for Web Application
 * 
 * Features:
 * - Real-time storage usage monitoring with visual indicators
 * - Storage optimization suggestions and cleanup utilities
 * - Storage quota management and warning systems
 * - Storage analytics and usage pattern reporting
 * 
 * Requirements addressed: 2.1, 2.4, 9.4, 9.5
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    HardDrive, AlertTriangle, CheckCircle, TrendingUp,
    Trash2, Archive, Zap, Settings, RefreshCw, Download,
    PieChart, BarChart3, Clock, FileText, Folder
} from 'lucide-react';
import { formatBytes, formatDate } from '@/utils/formatters';

// Types
interface StorageInfo {
    totalSpace: number;
    usedSpace: number;
    freeSpace: number;
    usagePercentage: number;
    warningLevel: 'normal' | 'warning' | 'critical' | 'full';
    lastUpdated: Date;
}

interface StorageQuota {
    maxTotalSize: number;
    maxFileCount: number;
    maxFileSize: number;
    retentionDays: number;
    autoCleanupEnabled: boolean;
    warningThreshold: number;
    criticalThreshold: number;
}

interface OptimizationSuggestion {
    id: string;
    type: 'duplicate_removal' | 'old_file_cleanup' | 'cache_cleanup' | 'compression';
    description: string;
    potentialSavings: number;
    priority: number;
    actionRequired: boolean;
    estimatedTime: string;
    filesAffected: string[];
}

interface StorageAnalytics {
    totalFiles: number;
    totalSize: number;
    fileTypeDistribution: Record<string, { count: number; totalSize: number; avgSize: number }>;
    sizeDistribution: Record<string, number>;
    ageDistribution: Record<string, number>;
    duplicateFiles: Array<{ key: string; paths: string[] }>;
}

export const StorageManager: React.FC = () => {
    // State
    const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
    const [storageQuota, setStorageQuota] = useState<StorageQuota | null>(null);
    const [analytics, setAnalytics] = useState<StorageAnalytics | null>(null);
    const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'optimization' | 'settings'>('overview');
    const [optimizationInProgress, setOptimizationInProgress] = useState<Set<string>>(new Set());

    // Mock data - in real app, this would come from API/service
    const mockStorageInfo: StorageInfo = {
        totalSpace: 500 * 1024 * 1024 * 1024, // 500GB
        usedSpace: 350 * 1024 * 1024 * 1024,  // 350GB
        freeSpace: 150 * 1024 * 1024 * 1024,  // 150GB
        usagePercentage: 70,
        warningLevel: 'warning',
        lastUpdated: new Date()
    };

    const mockQuota: StorageQuota = {
        maxTotalSize: 10 * 1024 * 1024 * 1024, // 10GB
        maxFileCount: 10000,
        maxFileSize: 100 * 1024 * 1024, // 100MB
        retentionDays: 365,
        autoCleanupEnabled: true,
        warningThreshold: 0.8,
        criticalThreshold: 0.9
    };

    const mockAnalytics: StorageAnalytics = {
        totalFiles: 1250,
        totalSize: 8.5 * 1024 * 1024 * 1024, // 8.5GB
        fileTypeDistribution: {
            '.wav': { count: 450, totalSize: 4.2 * 1024 * 1024 * 1024, avgSize: 9.5 * 1024 * 1024 },
            '.mp3': { count: 380, totalSize: 2.1 * 1024 * 1024 * 1024, avgSize: 5.6 * 1024 * 1024 },
            '.m4a': { count: 320, totalSize: 1.8 * 1024 * 1024 * 1024, avgSize: 5.7 * 1024 * 1024 },
            '.ogg': { count: 100, totalSize: 0.4 * 1024 * 1024 * 1024, avgSize: 4.1 * 1024 * 1024 }
        },
        sizeDistribution: {
            small: 320,  // < 1MB
            medium: 680, // 1-10MB
            large: 200,  // 10-100MB
            huge: 50     // > 100MB
        },
        ageDistribution: {
            recent: 180, // < 1 day
            week: 320,   // < 1 week
            month: 450,  // < 1 month
            old: 300     // > 1 month
        },
        duplicateFiles: [
            { key: 'recording_001.wav', paths: ['/path1/recording_001.wav', '/path2/recording_001.wav'] },
            { key: 'meeting_notes.mp3', paths: ['/path1/meeting_notes.mp3', '/path2/meeting_notes.mp3', '/path3/meeting_notes.mp3'] }
        ]
    };

    const mockSuggestions: OptimizationSuggestion[] = [
        {
            id: '1',
            type: 'duplicate_removal',
            description: 'Remove 15 sets of duplicate files',
            potentialSavings: 245 * 1024 * 1024, // 245MB
            priority: 5,
            actionRequired: true,
            estimatedTime: '5-10 minutes',
            filesAffected: ['recording_001.wav', 'meeting_notes.mp3']
        },
        {
            id: '2',
            type: 'old_file_cleanup',
            description: 'Archive 300 files older than 30 days',
            potentialSavings: 1.2 * 1024 * 1024 * 1024, // 1.2GB
            priority: 4,
            actionRequired: false,
            estimatedTime: '2-5 minutes',
            filesAffected: []
        },
        {
            id: '3',
            type: 'cache_cleanup',
            description: 'Clear application cache and temporary files',
            potentialSavings: 156 * 1024 * 1024, // 156MB
            priority: 3,
            actionRequired: false,
            estimatedTime: '1-2 minutes',
            filesAffected: []
        }
    ];

    // Initialize data
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);

            // Simulate API calls
            await new Promise(resolve => setTimeout(resolve, 1000));

            setStorageInfo(mockStorageInfo);
            setStorageQuota(mockQuota);
            setAnalytics(mockAnalytics);
            setSuggestions(mockSuggestions);
            setIsLoading(false);
        };

        loadData();
    }, []);

    // Refresh data
    const refreshData = useCallback(async () => {
        setIsLoading(true);
        // Simulate refresh
        await new Promise(resolve => setTimeout(resolve, 500));
        setStorageInfo({ ...mockStorageInfo, lastUpdated: new Date() });
        setIsLoading(false);
    }, []);

    // Execute optimization
    const executeOptimization = useCallback(async (suggestion: OptimizationSuggestion) => {
        setOptimizationInProgress(prev => new Set(prev).add(suggestion.id));

        try {
            // Simulate optimization execution
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Update storage info after optimization
            if (storageInfo) {
                const newUsedSpace = storageInfo.usedSpace - suggestion.potentialSavings;
                const newFreeSpace = storageInfo.freeSpace + suggestion.potentialSavings;
                const newUsagePercentage = (newUsedSpace / storageInfo.totalSpace) * 100;

                setStorageInfo({
                    ...storageInfo,
                    usedSpace: newUsedSpace,
                    freeSpace: newFreeSpace,
                    usagePercentage: newUsagePercentage,
                    warningLevel: newUsagePercentage > 90 ? 'critical' : newUsagePercentage > 80 ? 'warning' : 'normal',
                    lastUpdated: new Date()
                });
            }

            // Remove executed suggestion
            setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));

        } catch (error) {
            console.error('Optimization failed:', error);
        } finally {
            setOptimizationInProgress(prev => {
                const newSet = new Set(prev);
                newSet.delete(suggestion.id);
                return newSet;
            });
        }
    }, [storageInfo]);

    // Get warning level color
    const getWarningLevelColor = (level: string) => {
        switch (level) {
            case 'critical':
            case 'full':
                return 'text-red-400 bg-red-600/20';
            case 'warning':
                return 'text-yellow-400 bg-yellow-600/20';
            default:
                return 'text-green-400 bg-green-600/20';
        }
    };

    // Get priority color
    const getPriorityColor = (priority: number) => {
        if (priority >= 4) return 'text-red-400';
        if (priority >= 3) return 'text-yellow-400';
        return 'text-green-400';
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="w-8 h-8 animate-spin text-primary-400" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100">Storage Management</h1>
                    <p className="text-slate-400">
                        Monitor and optimize your storage usage
                    </p>
                </div>

                <button
                    onClick={refreshData}
                    className="btn-secondary flex items-center space-x-2"
                    disabled={isLoading}
                >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                </button>
            </div>

            {/* Storage Overview Card */}
            {storageInfo && (
                <div className="card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-slate-100 flex items-center space-x-2">
                            <HardDrive className="w-5 h-5" />
                            <span>Storage Overview</span>
                        </h2>

                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getWarningLevelColor(storageInfo.warningLevel)}`}>
                            {storageInfo.warningLevel.charAt(0).toUpperCase() + storageInfo.warningLevel.slice(1)}
                        </span>
                    </div>

                    {/* Usage Bar */}
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-slate-300">Storage Usage</span>
                            <span className="text-slate-300">{storageInfo.usagePercentage.toFixed(1)}%</span>
                        </div>

                        <div className="bg-slate-700 rounded-full h-3">
                            <div
                                className={`h-3 rounded-full transition-all duration-500 ${storageInfo.warningLevel === 'critical' || storageInfo.warningLevel === 'full'
                                        ? 'bg-red-500'
                                        : storageInfo.warningLevel === 'warning'
                                            ? 'bg-yellow-500'
                                            : 'bg-green-500'
                                    }`}
                                style={{ width: `${Math.min(storageInfo.usagePercentage, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Storage Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center">
                            <p className="text-2xl font-bold text-slate-100">{formatBytes(storageInfo.usedSpace)}</p>
                            <p className="text-sm text-slate-400">Used Space</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-slate-100">{formatBytes(storageInfo.freeSpace)}</p>
                            <p className="text-sm text-slate-400">Free Space</p>
                        </div>
                        <div className="text-center">
                            <p className="text-2xl font-bold text-slate-100">{formatBytes(storageInfo.totalSpace)}</p>
                            <p className="text-sm text-slate-400">Total Space</p>
                        </div>
                    </div>

                    <div className="mt-4 text-xs text-slate-500">
                        Last updated: {formatDate(storageInfo.lastUpdated)}
                    </div>
                </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex space-x-1 bg-slate-800 rounded-lg p-1">
                {[
                    { id: 'overview', label: 'Overview', icon: HardDrive },
                    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
                    { id: 'optimization', label: 'Optimization', icon: Zap },
                    { id: 'settings', label: 'Settings', icon: Settings }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors ${activeTab === tab.id
                                ? 'bg-slate-700 text-slate-100'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Quick Stats */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-slate-100 mb-4">Quick Stats</h3>

                        {analytics && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Total Files</span>
                                    <span className="text-slate-100 font-medium">{analytics.totalFiles.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Total Size</span>
                                    <span className="text-slate-100 font-medium">{formatBytes(analytics.totalSize)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Duplicate Files</span>
                                    <span className="text-slate-100 font-medium">{analytics.duplicateFiles.length}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-400">Old Files (>30 days)</span>
                                    <span className="text-slate-100 font-medium">{analytics.ageDistribution.old}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Top Optimization Suggestions */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-slate-100 mb-4">Top Suggestions</h3>

                        <div className="space-y-3">
                            {suggestions.slice(0, 3).map(suggestion => (
                                <div key={suggestion.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                                    <div className="flex-1">
                                        <p className="text-slate-100 font-medium">{suggestion.description}</p>
                                        <p className="text-sm text-slate-400">
                                            Save {formatBytes(suggestion.potentialSavings)} • {suggestion.estimatedTime}
                                        </p>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <span className={`text-xs font-medium ${getPriorityColor(suggestion.priority)}`}>
                                            Priority {suggestion.priority}
                                        </span>
                                        <button
                                            onClick={() => executeOptimization(suggestion)}
                                            disabled={optimizationInProgress.has(suggestion.id)}
                                            className="btn-primary text-sm px-3 py-1"
                                        >
                                            {optimizationInProgress.has(suggestion.id) ? 'Running...' : 'Execute'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'analytics' && analytics && (
                <div className="space-y-6">
                    {/* File Type Distribution */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center space-x-2">
                            <PieChart className="w-5 h-5" />
                            <span>File Type Distribution</span>
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(analytics.fileTypeDistribution).map(([type, data]) => (
                                <div key={type} className="bg-slate-700/50 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-slate-100 font-medium">{type.toUpperCase()}</span>
                                        <span className="text-slate-400">{data.count} files</span>
                                    </div>
                                    <div className="text-sm text-slate-400 space-y-1">
                                        <div>Total: {formatBytes(data.totalSize)}</div>
                                        <div>Average: {formatBytes(data.avgSize)}</div>
                                    </div>
                                    <div className="mt-2 bg-slate-600 rounded-full h-2">
                                        <div
                                            className="bg-primary-500 h-2 rounded-full"
                                            style={{ width: `${(data.totalSize / analytics.totalSize) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Size and Age Distribution */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="card p-6">
                            <h3 className="text-lg font-semibold text-slate-100 mb-4">Size Distribution</h3>

                            <div className="space-y-3">
                                {Object.entries(analytics.sizeDistribution).map(([size, count]) => (
                                    <div key={size} className="flex items-center justify-between">
                                        <span className="text-slate-400 capitalize">{size} Files</span>
                                        <span className="text-slate-100">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="card p-6">
                            <h3 className="text-lg font-semibold text-slate-100 mb-4">Age Distribution</h3>

                            <div className="space-y-3">
                                {Object.entries(analytics.ageDistribution).map(([age, count]) => (
                                    <div key={age} className="flex items-center justify-between">
                                        <span className="text-slate-400 capitalize">{age}</span>
                                        <span className="text-slate-100">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'optimization' && (
                <div className="space-y-6">
                    {/* Optimization Suggestions */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center space-x-2">
                            <Zap className="w-5 h-5" />
                            <span>Optimization Suggestions</span>
                        </h3>

                        <div className="space-y-4">
                            {suggestions.map(suggestion => (
                                <div key={suggestion.id} className="border border-slate-700 rounded-lg p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <div className="flex items-center space-x-2 mb-1">
                                                <h4 className="text-slate-100 font-medium">{suggestion.description}</h4>
                                                <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(suggestion.priority)} bg-current bg-opacity-20`}>
                                                    Priority {suggestion.priority}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-400 mb-2">
                                                Potential savings: {formatBytes(suggestion.potentialSavings)} •
                                                Estimated time: {suggestion.estimatedTime}
                                            </p>
                                            {suggestion.actionRequired && (
                                                <p className="text-xs text-yellow-400">⚠ User action required</p>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => executeOptimization(suggestion)}
                                            disabled={optimizationInProgress.has(suggestion.id)}
                                            className="btn-primary flex items-center space-x-2"
                                        >
                                            {optimizationInProgress.has(suggestion.id) ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                                    <span>Running...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Zap className="w-4 h-4" />
                                                    <span>Execute</span>
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    {suggestion.filesAffected.length > 0 && (
                                        <div className="text-xs text-slate-500">
                                            Files affected: {suggestion.filesAffected.slice(0, 3).join(', ')}
                                            {suggestion.filesAffected.length > 3 && ` and ${suggestion.filesAffected.length - 3} more`}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {suggestions.length === 0 && (
                                <div className="text-center py-8">
                                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                                    <h4 className="text-lg font-medium text-slate-100 mb-2">Storage Optimized</h4>
                                    <p className="text-slate-400">No optimization suggestions at this time.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'settings' && storageQuota && (
                <div className="space-y-6">
                    {/* Quota Settings */}
                    <div className="card p-6">
                        <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center space-x-2">
                            <Settings className="w-5 h-5" />
                            <span>Storage Quota Settings</span>
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Maximum Total Size
                                </label>
                                <input
                                    type="text"
                                    value={formatBytes(storageQuota.maxTotalSize)}
                                    readOnly
                                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Maximum File Count
                                </label>
                                <input
                                    type="number"
                                    value={storageQuota.maxFileCount}
                                    readOnly
                                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Maximum File Size
                                </label>
                                <input
                                    type="text"
                                    value={formatBytes(storageQuota.maxFileSize)}
                                    readOnly
                                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Retention Period (days)
                                </label>
                                <input
                                    type="number"
                                    value={storageQuota.retentionDays}
                                    readOnly
                                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100"
                                />
                            </div>
                        </div>

                        <div className="mt-6">
                            <label className="flex items-center space-x-3">
                                <input
                                    type="checkbox"
                                    checked={storageQuota.autoCleanupEnabled}
                                    readOnly
                                    className="rounded border-slate-500 bg-slate-700 text-primary-600"
                                />
                                <span className="text-slate-300">Enable automatic cleanup</span>
                            </label>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};