"""
Storage Management and Optimization System.

This module provides comprehensive storage management capabilities including:
- Real-time storage usage monitoring with visual indicators
- Storage optimization suggestions and cleanup utilities
- Storage quota management and warning systems
- Storage analytics and usage pattern reporting

Requirements addressed: 2.1, 2.4, 9.4, 9.5
"""

import os
import time
import json
import shutil
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from pathlib import Path
import threading
from enum import Enum

from config_and_logger import logger


class StorageWarningLevel(Enum):
    """Storage warning levels based on usage percentage."""
    NORMAL = "normal"      # < 70%
    WARNING = "warning"    # 70-85%
    CRITICAL = "critical"  # 85-95%
    FULL = "full"         # > 95%


class OptimizationType(Enum):
    """Types of storage optimizations."""
    DUPLICATE_REMOVAL = "duplicate_removal"
    OLD_FILE_CLEANUP = "old_file_cleanup"
    CACHE_CLEANUP = "cache_cleanup"
    TEMP_FILE_CLEANUP = "temp_file_cleanup"
    COMPRESSION = "compression"
    ARCHIVE_OLD_FILES = "archive_old_files"


@dataclass
class StorageInfo:
    """Storage information structure."""
    total_space: int
    used_space: int
    free_space: int
    usage_percentage: float
    warning_level: StorageWarningLevel
    last_updated: datetime


@dataclass
class StorageQuota:
    """Storage quota configuration."""
    max_total_size: int
    max_file_count: int
    max_file_size: int
    retention_days: int
    auto_cleanup_enabled: bool
    warning_threshold: float = 0.8
    critical_threshold: float = 0.9


@dataclass
class OptimizationSuggestion:
    """Storage optimization suggestion."""
    type: OptimizationType
    description: str
    potential_savings: int
    priority: int  # 1-5, 5 being highest priority
    action_required: bool
    estimated_time: str
    files_affected: List[str]


@dataclass
class StorageAnalytics:
    """Storage usage analytics."""
    total_files: int
    total_size: int
    file_type_distribution: Dict[str, Dict[str, Any]]
    size_distribution: Dict[str, int]
    age_distribution: Dict[str, int]
    access_patterns: Dict[str, Any]
    growth_trend: Dict[str, float]
    duplicate_files: List[Tuple[str, List[str]]]


class StorageMonitor:
    """Real-time storage monitoring with visual indicators."""
    
    def __init__(self, paths_to_monitor: List[str], update_interval: float = 30.0):
        self.paths_to_monitor = [Path(p) for p in paths_to_monitor]
        self.update_interval = update_interval
        self.storage_info: Dict[str, StorageInfo] = {}
        self.callbacks: List[callable] = []
        self.monitoring_thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        
        # Initialize monitoring
        self._update_storage_info()
        self.start_monitoring()
    
    def add_callback(self, callback: callable):
        """Add a callback to be notified of storage changes."""
        self.callbacks.append(callback)
    
    def remove_callback(self, callback: callable):
        """Remove a callback."""
        if callback in self.callbacks:
            self.callbacks.remove(callback)
    
    def start_monitoring(self):
        """Start the monitoring thread."""
        if self.monitoring_thread and self.monitoring_thread.is_alive():
            return
        
        self.stop_event.clear()
        self.monitoring_thread = threading.Thread(
            target=self._monitoring_loop,
            daemon=True
        )
        self.monitoring_thread.start()
        logger.info("StorageMonitor", "start_monitoring", "Storage monitoring started")
    
    def stop_monitoring(self):
        """Stop the monitoring thread."""
        self.stop_event.set()
        if self.monitoring_thread:
            self.monitoring_thread.join(timeout=5.0)
        logger.info("StorageMonitor", "stop_monitoring", "Storage monitoring stopped")
    
    def _monitoring_loop(self):
        """Main monitoring loop."""
        while not self.stop_event.wait(self.update_interval):
            try:
                old_info = self.storage_info.copy()
                self._update_storage_info()
                
                # Check for significant changes
                for path_str, new_info in self.storage_info.items():
                    old_info_for_path = old_info.get(path_str)
                    if (not old_info_for_path or 
                        abs(new_info.usage_percentage - old_info_for_path.usage_percentage) > 1.0 or
                        new_info.warning_level != old_info_for_path.warning_level):
                        
                        # Notify callbacks
                        for callback in self.callbacks:
                            try:
                                callback(path_str, new_info)
                            except Exception as e:
                                logger.error("StorageMonitor", "_monitoring_loop", 
                                           f"Callback error: {e}")
                
            except Exception as e:
                logger.error("StorageMonitor", "_monitoring_loop", f"Monitoring error: {e}")
    
    def _update_storage_info(self):
        """Update storage information for all monitored paths."""
        for path in self.paths_to_monitor:
            if not path.exists():
                continue
            
            try:
                # Get disk usage
                total, used, free = shutil.disk_usage(path)
                usage_percentage = (used / total) * 100 if total > 0 else 0
                
                # Determine warning level
                if usage_percentage >= 95:
                    warning_level = StorageWarningLevel.FULL
                elif usage_percentage >= 85:
                    warning_level = StorageWarningLevel.CRITICAL
                elif usage_percentage >= 70:
                    warning_level = StorageWarningLevel.WARNING
                else:
                    warning_level = StorageWarningLevel.NORMAL
                
                self.storage_info[str(path)] = StorageInfo(
                    total_space=total,
                    used_space=used,
                    free_space=free,
                    usage_percentage=usage_percentage,
                    warning_level=warning_level,
                    last_updated=datetime.now()
                )
                
            except Exception as e:
                logger.error("StorageMonitor", "_update_storage_info", 
                           f"Failed to get storage info for {path}: {e}")
    
    def get_storage_info(self, path: str = None) -> Dict[str, StorageInfo]:
        """Get current storage information."""
        if path:
            return {path: self.storage_info.get(path)} if path in self.storage_info else {}
        return self.storage_info.copy()
    
    def get_warning_level(self, path: str) -> StorageWarningLevel:
        """Get warning level for a specific path."""
        info = self.storage_info.get(path)
        return info.warning_level if info else StorageWarningLevel.NORMAL


class StorageOptimizer:
    """Storage optimization suggestions and cleanup utilities."""
    
    def __init__(self, base_paths: List[str], cache_dir: str = None):
        self.base_paths = [Path(p) for p in base_paths]
        self.cache_dir = Path(cache_dir) if cache_dir else Path.home() / ".hidock" / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Database for tracking file information
        self.db_path = self.cache_dir / "storage_optimization.db"
        self._init_database()
    
    def _init_database(self):
        """Initialize the optimization database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS file_tracking (
                    file_path TEXT PRIMARY KEY,
                    file_size INTEGER,
                    file_hash TEXT,
                    last_accessed TEXT,
                    last_modified TEXT,
                    access_count INTEGER DEFAULT 0,
                    created_date TEXT
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS optimization_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    optimization_type TEXT,
                    files_affected INTEGER,
                    space_saved INTEGER,
                    execution_time REAL,
                    timestamp TEXT
                )
            """)
            conn.commit()
    
    def analyze_storage(self) -> StorageAnalytics:
        """Perform comprehensive storage analysis."""
        logger.info("StorageOptimizer", "analyze_storage", "Starting storage analysis")
        
        total_files = 0
        total_size = 0
        file_type_distribution = {}
        size_distribution = {"small": 0, "medium": 0, "large": 0, "huge": 0}
        age_distribution = {"recent": 0, "week": 0, "month": 0, "old": 0}
        duplicate_files = []
        file_hashes = {}
        
        now = datetime.now()
        
        for base_path in self.base_paths:
            if not base_path.exists():
                continue
            
            for file_path in base_path.rglob("*"):
                if not file_path.is_file():
                    continue
                
                try:
                    stat = file_path.stat()
                    file_size = stat.st_size
                    modified_time = datetime.fromtimestamp(stat.st_mtime)
                    
                    total_files += 1
                    total_size += file_size
                    
                    # File type distribution
                    extension = file_path.suffix.lower()
                    if extension not in file_type_distribution:
                        file_type_distribution[extension] = {
                            "count": 0,
                            "total_size": 0,
                            "avg_size": 0
                        }
                    
                    file_type_distribution[extension]["count"] += 1
                    file_type_distribution[extension]["total_size"] += file_size
                    file_type_distribution[extension]["avg_size"] = (
                        file_type_distribution[extension]["total_size"] / 
                        file_type_distribution[extension]["count"]
                    )
                    
                    # Size distribution
                    if file_size < 1024 * 1024:  # < 1MB
                        size_distribution["small"] += 1
                    elif file_size < 10 * 1024 * 1024:  # < 10MB
                        size_distribution["medium"] += 1
                    elif file_size < 100 * 1024 * 1024:  # < 100MB
                        size_distribution["large"] += 1
                    else:
                        size_distribution["huge"] += 1
                    
                    # Age distribution
                    age_days = (now - modified_time).days
                    if age_days <= 1:
                        age_distribution["recent"] += 1
                    elif age_days <= 7:
                        age_distribution["week"] += 1
                    elif age_days <= 30:
                        age_distribution["month"] += 1
                    else:
                        age_distribution["old"] += 1
                    
                    # Duplicate detection (simplified - using size as hash for performance)
                    file_key = f"{file_size}_{file_path.name}"
                    if file_key in file_hashes:
                        file_hashes[file_key].append(str(file_path))
                    else:
                        file_hashes[file_key] = [str(file_path)]
                    
                except Exception as e:
                    logger.warning("StorageOptimizer", "analyze_storage", 
                                 f"Error analyzing {file_path}: {e}")
        
        # Find duplicates
        duplicate_files = [
            (key, paths) for key, paths in file_hashes.items() 
            if len(paths) > 1
        ]
        
        # Calculate growth trend (simplified)
        growth_trend = {"daily": 0.0, "weekly": 0.0, "monthly": 0.0}
        
        # Access patterns (simplified)
        access_patterns = {
            "frequently_accessed": [],
            "rarely_accessed": [],
            "never_accessed": []
        }
        
        analytics = StorageAnalytics(
            total_files=total_files,
            total_size=total_size,
            file_type_distribution=file_type_distribution,
            size_distribution=size_distribution,
            age_distribution=age_distribution,
            access_patterns=access_patterns,
            growth_trend=growth_trend,
            duplicate_files=duplicate_files
        )
        
        logger.info("StorageOptimizer", "analyze_storage", 
                   f"Analysis complete: {total_files} files, {total_size / (1024*1024):.1f} MB")
        
        return analytics
    
    def generate_optimization_suggestions(self, analytics: StorageAnalytics) -> List[OptimizationSuggestion]:
        """Generate storage optimization suggestions based on analysis."""
        suggestions = []
        
        # Duplicate file removal
        if analytics.duplicate_files:
            duplicate_savings = sum(
                len(paths) - 1 for _, paths in analytics.duplicate_files
            ) * 1024 * 1024  # Rough estimate
            
            suggestions.append(OptimizationSuggestion(
                type=OptimizationType.DUPLICATE_REMOVAL,
                description=f"Remove {len(analytics.duplicate_files)} sets of duplicate files",
                potential_savings=duplicate_savings,
                priority=4,
                action_required=True,
                estimated_time="5-10 minutes",
                files_affected=[path for _, paths in analytics.duplicate_files for path in paths[1:]]
            ))
        
        # Old file cleanup
        old_files_count = analytics.age_distribution.get("old", 0)
        if old_files_count > 100:
            old_file_savings = old_files_count * 2 * 1024 * 1024  # Rough estimate
            
            suggestions.append(OptimizationSuggestion(
                type=OptimizationType.OLD_FILE_CLEANUP,
                description=f"Archive or remove {old_files_count} files older than 30 days",
                potential_savings=old_file_savings,
                priority=3,
                action_required=False,
                estimated_time="2-5 minutes",
                files_affected=[]
            ))
        
        # Cache cleanup
        cache_size = self._estimate_cache_size()
        if cache_size > 100 * 1024 * 1024:  # > 100MB
            suggestions.append(OptimizationSuggestion(
                type=OptimizationType.CACHE_CLEANUP,
                description="Clear application cache and temporary files",
                potential_savings=cache_size,
                priority=2,
                action_required=False,
                estimated_time="1-2 minutes",
                files_affected=[]
            ))
        
        # Large file compression
        large_files_count = analytics.size_distribution.get("large", 0) + analytics.size_distribution.get("huge", 0)
        if large_files_count > 10:
            compression_savings = large_files_count * 5 * 1024 * 1024  # Rough estimate
            
            suggestions.append(OptimizationSuggestion(
                type=OptimizationType.COMPRESSION,
                description=f"Compress {large_files_count} large files to save space",
                potential_savings=compression_savings,
                priority=2,
                action_required=True,
                estimated_time="10-30 minutes",
                files_affected=[]
            ))
        
        # Sort by priority
        suggestions.sort(key=lambda x: x.priority, reverse=True)
        
        return suggestions
    
    def _estimate_cache_size(self) -> int:
        """Estimate the size of cache and temporary files."""
        cache_size = 0
        
        # Check application cache
        if self.cache_dir.exists():
            for file_path in self.cache_dir.rglob("*"):
                if file_path.is_file():
                    try:
                        cache_size += file_path.stat().st_size
                    except:
                        pass
        
        # Check system temp directories
        temp_dirs = [Path.home() / "AppData" / "Local" / "Temp", Path("/tmp")]
        for temp_dir in temp_dirs:
            if temp_dir.exists():
                for file_path in temp_dir.glob("hidock_*"):
                    if file_path.is_file():
                        try:
                            cache_size += file_path.stat().st_size
                        except:
                            pass
        
        return cache_size
    
    def execute_optimization(self, suggestion: OptimizationSuggestion, dry_run: bool = False) -> Dict[str, Any]:
        """Execute a storage optimization suggestion."""
        start_time = time.time()
        result = {
            "success": False,
            "files_processed": 0,
            "space_saved": 0,
            "errors": [],
            "dry_run": dry_run
        }
        
        try:
            if suggestion.type == OptimizationType.DUPLICATE_REMOVAL:
                result = self._remove_duplicates(suggestion.files_affected, dry_run)
            elif suggestion.type == OptimizationType.OLD_FILE_CLEANUP:
                result = self._cleanup_old_files(dry_run)
            elif suggestion.type == OptimizationType.CACHE_CLEANUP:
                result = self._cleanup_cache(dry_run)
            elif suggestion.type == OptimizationType.TEMP_FILE_CLEANUP:
                result = self._cleanup_temp_files(dry_run)
            else:
                result["errors"].append(f"Optimization type {suggestion.type} not implemented")
            
            execution_time = time.time() - start_time
            
            # Record optimization history
            if not dry_run and result["success"]:
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("""
                        INSERT INTO optimization_history 
                        (optimization_type, files_affected, space_saved, execution_time, timestamp)
                        VALUES (?, ?, ?, ?, ?)
                    """, (
                        suggestion.type.value,
                        result["files_processed"],
                        result["space_saved"],
                        execution_time,
                        datetime.now().isoformat()
                    ))
                    conn.commit()
            
            logger.info("StorageOptimizer", "execute_optimization", 
                       f"Optimization {suggestion.type.value} completed: "
                       f"{result['files_processed']} files, "
                       f"{result['space_saved'] / (1024*1024):.1f} MB saved")
            
        except Exception as e:
            result["errors"].append(str(e))
            logger.error("StorageOptimizer", "execute_optimization", 
                        f"Optimization failed: {e}")
        
        return result
    
    def _remove_duplicates(self, duplicate_files: List[str], dry_run: bool) -> Dict[str, Any]:
        """Remove duplicate files."""
        result = {"success": True, "files_processed": 0, "space_saved": 0, "errors": []}
        
        for file_path_str in duplicate_files:
            file_path = Path(file_path_str)
            if not file_path.exists():
                continue
            
            try:
                file_size = file_path.stat().st_size
                
                if not dry_run:
                    file_path.unlink()
                
                result["files_processed"] += 1
                result["space_saved"] += file_size
                
            except Exception as e:
                result["errors"].append(f"Failed to remove {file_path}: {e}")
        
        return result
    
    def _cleanup_old_files(self, dry_run: bool, days_old: int = 30) -> Dict[str, Any]:
        """Clean up files older than specified days."""
        result = {"success": True, "files_processed": 0, "space_saved": 0, "errors": []}
        cutoff_date = datetime.now() - timedelta(days=days_old)
        
        for base_path in self.base_paths:
            if not base_path.exists():
                continue
            
            for file_path in base_path.rglob("*"):
                if not file_path.is_file():
                    continue
                
                try:
                    modified_time = datetime.fromtimestamp(file_path.stat().st_mtime)
                    if modified_time < cutoff_date:
                        file_size = file_path.stat().st_size
                        
                        if not dry_run:
                            file_path.unlink()
                        
                        result["files_processed"] += 1
                        result["space_saved"] += file_size
                
                except Exception as e:
                    result["errors"].append(f"Failed to process {file_path}: {e}")
        
        return result
    
    def _cleanup_cache(self, dry_run: bool) -> Dict[str, Any]:
        """Clean up cache and temporary files."""
        result = {"success": True, "files_processed": 0, "space_saved": 0, "errors": []}
        
        # Clean application cache
        if self.cache_dir.exists():
            for file_path in self.cache_dir.rglob("*"):
                if file_path.is_file():
                    try:
                        file_size = file_path.stat().st_size
                        
                        if not dry_run:
                            file_path.unlink()
                        
                        result["files_processed"] += 1
                        result["space_saved"] += file_size
                    
                    except Exception as e:
                        result["errors"].append(f"Failed to remove cache file {file_path}: {e}")
        
        return result
    
    def _cleanup_temp_files(self, dry_run: bool) -> Dict[str, Any]:
        """Clean up temporary files."""
        result = {"success": True, "files_processed": 0, "space_saved": 0, "errors": []}
        
        # Clean HiDock-specific temp files
        temp_patterns = ["hidock_*", "*.tmp", "*.temp"]
        temp_dirs = [Path.home() / "AppData" / "Local" / "Temp", Path("/tmp")]
        
        for temp_dir in temp_dirs:
            if not temp_dir.exists():
                continue
            
            for pattern in temp_patterns:
                for file_path in temp_dir.glob(pattern):
                    if file_path.is_file():
                        try:
                            file_size = file_path.stat().st_size
                            
                            if not dry_run:
                                file_path.unlink()
                            
                            result["files_processed"] += 1
                            result["space_saved"] += file_size
                        
                        except Exception as e:
                            result["errors"].append(f"Failed to remove temp file {file_path}: {e}")
        
        return result
    
    def get_optimization_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get optimization history."""
        history = []
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                SELECT optimization_type, files_affected, space_saved, execution_time, timestamp
                FROM optimization_history
                ORDER BY timestamp DESC
                LIMIT ?
            """, (limit,))
            
            for row in cursor.fetchall():
                history.append({
                    "optimization_type": row[0],
                    "files_affected": row[1],
                    "space_saved": row[2],
                    "execution_time": row[3],
                    "timestamp": row[4]
                })
        
        return history


class StorageQuotaManager:
    """Storage quota management and warning systems."""
    
    def __init__(self, quota_config: StorageQuota, storage_monitor: StorageMonitor):
        self.quota_config = quota_config
        self.storage_monitor = storage_monitor
        self.warning_callbacks: List[callable] = []
        
        # Register for storage updates
        self.storage_monitor.add_callback(self._check_quota_violations)
    
    def add_warning_callback(self, callback: callable):
        """Add a callback for quota warnings."""
        self.warning_callbacks.append(callback)
    
    def remove_warning_callback(self, callback: callable):
        """Remove a warning callback."""
        if callback in self.warning_callbacks:
            self.warning_callbacks.remove(callback)
    
    def _check_quota_violations(self, path: str, storage_info: StorageInfo):
        """Check for quota violations and trigger warnings."""
        violations = []
        
        # Check usage percentage
        if storage_info.usage_percentage >= self.quota_config.critical_threshold * 100:
            violations.append({
                "type": "critical_usage",
                "message": f"Storage usage is critically high: {storage_info.usage_percentage:.1f}%",
                "severity": "critical"
            })
        elif storage_info.usage_percentage >= self.quota_config.warning_threshold * 100:
            violations.append({
                "type": "warning_usage",
                "message": f"Storage usage is high: {storage_info.usage_percentage:.1f}%",
                "severity": "warning"
            })
        
        # Check free space
        if storage_info.free_space < 1024 * 1024 * 1024:  # < 1GB
            violations.append({
                "type": "low_free_space",
                "message": f"Low free space: {storage_info.free_space / (1024*1024*1024):.1f} GB remaining",
                "severity": "critical"
            })
        
        # Notify callbacks
        for violation in violations:
            for callback in self.warning_callbacks:
                try:
                    callback(path, violation, storage_info)
                except Exception as e:
                    logger.error("StorageQuotaManager", "_check_quota_violations", 
                               f"Warning callback error: {e}")
    
    def check_file_quota(self, file_size: int, file_count: int = 1) -> Tuple[bool, List[str]]:
        """Check if adding files would violate quotas."""
        violations = []
        
        # Check file size limit
        if file_size > self.quota_config.max_file_size:
            violations.append(f"File size {file_size / (1024*1024):.1f} MB exceeds limit of {self.quota_config.max_file_size / (1024*1024):.1f} MB")
        
        # Check total size limit (simplified - would need actual usage data)
        # This would require integration with actual storage tracking
        
        # Check file count limit (simplified)
        # This would require integration with actual file counting
        
        return len(violations) == 0, violations
    
    def get_quota_status(self) -> Dict[str, Any]:
        """Get current quota status."""
        storage_info = list(self.storage_monitor.get_storage_info().values())
        if not storage_info:
            return {"error": "No storage information available"}
        
        # Use first storage info (could be enhanced to handle multiple paths)
        info = storage_info[0]
        
        return {
            "quota_config": asdict(self.quota_config),
            "current_usage": {
                "total_space": info.total_space,
                "used_space": info.used_space,
                "free_space": info.free_space,
                "usage_percentage": info.usage_percentage,
                "warning_level": info.warning_level.value
            },
            "quota_violations": self._get_current_violations(info),
            "recommendations": self._get_quota_recommendations(info)
        }
    
    def _get_current_violations(self, storage_info: StorageInfo) -> List[Dict[str, str]]:
        """Get current quota violations."""
        violations = []
        
        if storage_info.usage_percentage >= self.quota_config.critical_threshold * 100:
            violations.append({
                "type": "critical_usage",
                "message": f"Storage usage is critically high: {storage_info.usage_percentage:.1f}%"
            })
        elif storage_info.usage_percentage >= self.quota_config.warning_threshold * 100:
            violations.append({
                "type": "warning_usage",
                "message": f"Storage usage is high: {storage_info.usage_percentage:.1f}%"
            })
        
        return violations
    
    def _get_quota_recommendations(self, storage_info: StorageInfo) -> List[str]:
        """Get quota management recommendations."""
        recommendations = []
        
        if storage_info.usage_percentage > 80:
            recommendations.append("Consider enabling automatic cleanup")
            recommendations.append("Review and delete old or unnecessary files")
            recommendations.append("Run storage optimization to free up space")
        
        if storage_info.warning_level in [StorageWarningLevel.CRITICAL, StorageWarningLevel.FULL]:
            recommendations.append("Immediate action required - storage is nearly full")
            recommendations.append("Move files to external storage or cloud backup")
        
        if not self.quota_config.auto_cleanup_enabled:
            recommendations.append("Enable automatic cleanup to maintain storage health")
        
        return recommendations
    
    def update_quota_config(self, new_config: StorageQuota):
        """Update quota configuration."""
        self.quota_config = new_config
        logger.info("StorageQuotaManager", "update_quota_config", "Quota configuration updated")
    
    def enable_auto_cleanup(self, enabled: bool = True):
        """Enable or disable automatic cleanup."""
        self.quota_config.auto_cleanup_enabled = enabled
        logger.info("StorageQuotaManager", "enable_auto_cleanup", 
                   f"Auto cleanup {'enabled' if enabled else 'disabled'}")


# Example usage and integration
def create_storage_management_system(
    base_paths: List[str], 
    download_dir: str,
    quota_config: StorageQuota = None
) -> Tuple[StorageMonitor, StorageOptimizer, StorageQuotaManager]:
    """Create a complete storage management system."""
    
    # Default quota configuration
    if quota_config is None:
        quota_config = StorageQuota(
            max_total_size=10 * 1024 * 1024 * 1024,  # 10GB
            max_file_count=10000,
            max_file_size=100 * 1024 * 1024,  # 100MB
            retention_days=365,
            auto_cleanup_enabled=True,
            warning_threshold=0.8,
            critical_threshold=0.9
        )
    
    # Create components
    storage_monitor = StorageMonitor([download_dir] + base_paths)
    storage_optimizer = StorageOptimizer(base_paths)
    quota_manager = StorageQuotaManager(quota_config, storage_monitor)
    
    logger.info("StorageManagement", "create_system", "Storage management system created")
    
    return storage_monitor, storage_optimizer, quota_manager