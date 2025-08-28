#!/usr/bin/env python3
"""
Calendar Cache Migration Script

Fixes existing cache entries that have 'No Meeting' display text.
Converts them to empty strings as per the new UX requirements.
"""

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

def migrate_cache():
    """Migrate existing calendar cache to fix display text issues."""
    print("🔧 CALENDAR CACHE MIGRATION")
    print("=" * 60)
    
    cache_dir = Path.home() / ".hidock" / "calendar_cache"
    meetings_file = cache_dir / "meetings_cache.json"
    file_mappings_file = cache_dir / "file_meetings_cache.json"
    
    if not cache_dir.exists():
        print("❌ Cache directory does not exist!")
        return
    
    if not meetings_file.exists():
        print("❌ Meetings cache file does not exist!")
        return
    
    # Create backup
    backup_file = cache_dir / f"meetings_cache_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    try:
        print(f"📦 Creating backup: {backup_file}")
        shutil.copy2(meetings_file, backup_file)
        
        # Load current cache
        with open(meetings_file, 'r', encoding='utf-8') as f:
            meetings = json.load(f)
        
        print(f"📊 Loaded {len(meetings)} meetings from cache")
        
        # Migrate entries
        fixed_count = 0
        
        for meeting_key, meeting_data in meetings.items():
            # Fix entries with "No Meeting" display text
            if meeting_data.get('display_text') == 'No Meeting':
                meeting_data['display_text'] = ''
                fixed_count += 1
                print(f"   Fixed: {meeting_key}")
        
        print(f"\n🔧 MIGRATION RESULTS:")
        print(f"  Entries fixed: {fixed_count}")
        
        if fixed_count > 0:
            # Save the migrated cache
            print(f"💾 Saving migrated cache...")
            with open(meetings_file, 'w', encoding='utf-8') as f:
                json.dump(meetings, f, indent=2, ensure_ascii=False)
            
            print(f"✅ Cache migration completed successfully!")
            print(f"📦 Backup saved at: {backup_file}")
        else:
            print(f"✅ No migration needed - cache is already correct")
            # Remove unnecessary backup
            backup_file.unlink()
        
        # Show updated statistics
        real_meetings = 0
        no_meeting_entries = 0
        
        for meeting_key, meeting_data in meetings.items():
            if meeting_data.get('subject'):
                real_meetings += 1
            else:
                no_meeting_entries += 1
        
        print(f"\n📊 UPDATED STATISTICS:")
        print(f"  Real meetings: {real_meetings}")
        print(f"  'No meeting' entries: {no_meeting_entries}")
        print(f"  Entries with 'No Meeting' display text: 0 (fixed)")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        
        # Try to restore backup if it exists
        if backup_file.exists():
            try:
                shutil.copy2(backup_file, meetings_file)
                print(f"🔄 Restored from backup")
            except:
                pass

def verify_migration():
    """Verify the migration was successful."""
    print("\n🔍 VERIFYING MIGRATION...")
    
    cache_dir = Path.home() / ".hidock" / "calendar_cache"
    meetings_file = cache_dir / "meetings_cache.json"
    
    try:
        with open(meetings_file, 'r', encoding='utf-8') as f:
            meetings = json.load(f)
        
        # Count problematic entries
        no_meeting_text_count = 0
        for meeting_data in meetings.values():
            if meeting_data.get('display_text') == 'No Meeting':
                no_meeting_text_count += 1
        
        if no_meeting_text_count == 0:
            print("✅ Migration verification PASSED - no 'No Meeting' display text found")
        else:
            print(f"❌ Migration verification FAILED - {no_meeting_text_count} entries still have 'No Meeting' text")
            
    except Exception as e:
        print(f"❌ Verification failed: {e}")

if __name__ == "__main__":
    migrate_cache()
    verify_migration()
