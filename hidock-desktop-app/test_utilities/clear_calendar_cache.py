#!/usr/bin/env python3
"""
Clear Calendar Cache
This script clears the stale calendar cache to force fresh data retrieval
"""

import os
import glob
import json

def clear_calendar_cache():
    """Clear all calendar cache files"""
    print("=" * 60)
    print("CLEARING HIDOCK CALENDAR CACHE")
    print("=" * 60)
    
    # Find cache directory
    cache_dirs = [
        os.path.expanduser("~/.hidock"),
        "cache",
        ".cache"
    ]
    
    cache_files_removed = 0
    
    for cache_dir in cache_dirs:
        if os.path.exists(cache_dir):
            print(f"\n📁 Checking cache directory: {cache_dir}")
            
            # Calendar cache files to remove
            cache_patterns = [
                "meetings_cache.json",
                "file_meetings_cache.json",
                "calendar_*.json",
                "outlook_calendar_cache.json"
            ]
            
            for pattern in cache_patterns:
                cache_files = glob.glob(os.path.join(cache_dir, pattern))
                for cache_file in cache_files:
                    try:
                        print(f"   🗑️  Removing: {os.path.basename(cache_file)}")
                        os.remove(cache_file)
                        cache_files_removed += 1
                    except Exception as e:
                        print(f"   ❌ Error removing {cache_file}: {e}")
    
    # Also check current directory for cache files
    print(f"\n📁 Checking current directory for cache files...")
    current_dir_patterns = [
        "outlook_calendar_cache.json",
        "calendar_*.json",
        "*_cache.json"
    ]
    
    for pattern in current_dir_patterns:
        cache_files = glob.glob(pattern)
        for cache_file in cache_files:
            if "calendar" in cache_file.lower() or "meeting" in cache_file.lower():
                try:
                    print(f"   🗑️  Removing: {cache_file}")
                    os.remove(cache_file)
                    cache_files_removed += 1
                except Exception as e:
                    print(f"   ❌ Error removing {cache_file}: {e}")
    
    print(f"\n✅ Cache clearing complete!")
    print(f"   Total files removed: {cache_files_removed}")
    
    if cache_files_removed > 0:
        print(f"\n📋 Next steps:")
        print(f"   1. Restart the HiDock Desktop app")
        print(f"   2. Select the same 9 files from May 15, 2025")
        print(f"   3. Click 'Check Selected Files for Meetings' again")
        print(f"   4. The app should now fetch fresh data from Outlook")
    else:
        print(f"\n⚠️  No calendar cache files found to remove.")
        print(f"   The cache might be in a different location or already cleared.")

def main():
    clear_calendar_cache()

if __name__ == "__main__":
    main()
