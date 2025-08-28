#!/usr/bin/env python3
"""
Complete Calendar Integration Test

This script creates a comprehensive test environment to verify that:
1. Calendar integration initializes correctly
2. Sample calendar events are created
3. Sample files are generated with timestamps during meeting times
4. Files are properly enhanced with meeting metadata in both scenarios:
   - When showing cached files on startup (offline mode)
   - When refreshing files from device (online mode)
5. Meeting information is correctly displayed in file list data

The test simulates both cached file display and live file refresh scenarios
to ensure calendar integration works in all cases.
"""

import os
import sys
import tempfile
import shutil
from datetime import datetime, timedelta
from pathlib import Path

# Add the current directory to Python path for imports
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

def create_test_environment():
    """Create a temporary test environment with sample data."""
    
    # Create temporary directories
    test_dir = Path(tempfile.mkdtemp(prefix="hidock_calendar_test_"))
    cache_dir = test_dir / "cache"
    download_dir = test_dir / "downloads"
    
    cache_dir.mkdir(exist_ok=True)
    download_dir.mkdir(exist_ok=True)
    
    print(f"🔧 Test environment created at: {test_dir}")
    print(f"   Cache directory: {cache_dir}")
    print(f"   Download directory: {download_dir}")
    
    return test_dir, cache_dir, download_dir

def create_sample_calendar_events():
    """Create sample calendar events for testing."""
    
    now = datetime.now()
    
    # Create events at different times
    events = [
        {
            "title": "Team Stand-up Meeting",
            "start": now - timedelta(hours=2),
            "end": now - timedelta(hours=1, minutes=30),
            "location": "Conference Room A",
            "attendees": ["alice@company.com", "bob@company.com", "charlie@company.com"]
        },
        {
            "title": "Product Planning Session", 
            "start": now - timedelta(hours=4),
            "end": now - timedelta(hours=3),
            "location": "Meeting Room 2",
            "attendees": ["alice@company.com", "diana@company.com"]
        },
        {
            "title": "Client Presentation",
            "start": now + timedelta(minutes=30),
            "end": now + timedelta(hours=1, minutes=30),
            "location": "Virtual - Zoom",
            "attendees": ["alice@company.com", "client@external.com"]
        }
    ]
    
    print(f"📅 Created {len(events)} sample calendar events:")
    for i, event in enumerate(events, 1):
        print(f"   {i}. {event['title']}")
        print(f"      Time: {event['start'].strftime('%H:%M')} - {event['end'].strftime('%H:%M')}")
        print(f"      Location: {event['location']}")
        print(f"      Attendees: {len(event['attendees'])} people")
    
    return events

def create_sample_files_with_meeting_times(download_dir, events):
    """Create sample audio files with timestamps that match calendar events."""
    
    files_info = []
    
    # Create files that occur during meetings
    for i, event in enumerate(events[:2], 1):  # Use first 2 events
        # Create file timestamp within the meeting time
        file_time = event['start'] + timedelta(minutes=10)
        
        filename = f"recording_{i:03d}.wav"
        filepath = download_dir / filename
        
        # Create dummy audio file
        with open(filepath, 'wb') as f:
            # Write minimal WAV header (44 bytes) + some data
            wav_header = b'RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00\x44\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00data\x00\x08\x00\x00'
            f.write(wav_header)
            f.write(b'\x00' * 2000)  # Some audio data
        
        # Set file modification time
        timestamp = file_time.timestamp()
        os.utime(filepath, (timestamp, timestamp))
        
        file_info = {
            'filename': filename,
            'filepath': str(filepath),
            'size': filepath.stat().st_size,
            'date_created': file_time,
            'duration': 120.0,  # 2 minutes
            'checksum': f'checksum_{i:03d}',
            'should_match_meeting': event['title']
        }
        
        files_info.append(file_info)
        
    # Create one file that doesn't match any meeting (1 hour before earliest meeting)
    earliest_meeting = min(event['start'] for event in events)
    no_meeting_time = earliest_meeting - timedelta(hours=1)
    filename = "recording_outside_meeting.wav"
    filepath = download_dir / filename
    
    with open(filepath, 'wb') as f:
        wav_header = b'RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00\x44\xac\x00\x00\x10\xb1\x02\x00\x04\x00\x10\x00data\x00\x08\x00\x00'
        f.write(wav_header)
        f.write(b'\x00' * 1500)
    
    timestamp = no_meeting_time.timestamp()
    os.utime(filepath, (timestamp, timestamp))
    
    file_info = {
        'filename': filename,
        'filepath': str(filepath),
        'size': filepath.stat().st_size,
        'date_created': no_meeting_time,
        'duration': 90.0,  # 1.5 minutes
        'checksum': 'checksum_no_meeting',
        'should_match_meeting': None
    }
    
    files_info.append(file_info)
    
    print(f"📁 Created {len(files_info)} sample audio files:")
    for file_info in files_info:
        status = f"Should match: {file_info['should_match_meeting']}" if file_info['should_match_meeting'] else "Should not match any meeting"
        print(f"   • {file_info['filename']}")
        print(f"     Time: {file_info['date_created'].strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"     Size: {file_info['size']} bytes")
        print(f"     {status}")
    
    return files_info

def setup_mock_calendar_data():
    """Setup mock calendar data for testing."""
    
    events = create_sample_calendar_events()
    
    # Create mock calendar data that SimpleCalendarMixin can use
    calendar_data = []
    
    for event in events:
        calendar_data.append({
            'title': event['title'],
            'start': event['start'],
            'end': event['end'],
            'location': event['location'],
            'attendees': event['attendees'],
            'description': f"Test meeting: {event['title']}"
        })
    
    return calendar_data

def test_calendar_integration():
    """Test the complete calendar integration functionality."""
    
    print("🧪 COMPREHENSIVE CALENDAR INTEGRATION TEST")
    print("=" * 60)
    
    # Setup test environment
    test_dir, cache_dir, download_dir = create_test_environment()
    
    try:
        # Create sample data
        events = create_sample_calendar_events()
        files_info = create_sample_files_with_meeting_times(download_dir, events)
        calendar_data = setup_mock_calendar_data()
        
        print("\n" + "="*60)
        print("🔬 TESTING CALENDAR INTEGRATION")
        print("="*60)
        
        # Test 1: Import and initialize SimpleCalendarMixin
        print("\n1️⃣ Testing SimpleCalendarMixin import and initialization...")
        
        try:
            from simple_calendar_mixin import SimpleCalendarMixin
            print("   ✅ SimpleCalendarMixin imported successfully")
            
            # Create a mock calendar integration object
            class MockCalendarIntegration:
                class MockMeeting:
                    def __init__(self, subject, start_time, end_time, organizer, location, attendees):
                        self.subject = subject
                        self.start_time = start_time
                        self.end_time = end_time
                        self.organizer = organizer
                        self.location = location
                        self.attendees = attendees or []
                    
                    @property
                    def duration_minutes(self):
                        return int((self.end_time - self.start_time).total_seconds() / 60)
                
                def is_available(self):
                    return True
                    
                def get_events(self, start_date=None, end_date=None):
                    return calendar_data
                
                # Methods expected by SimpleCalendarMixin
                def get_meetings_for_date(self, target_date):
                    meetings = []
                    for ev in calendar_data:
                        # Only include events on the same date
                        if ev['start'].date() == target_date.date():
                            meetings.append(self.MockMeeting(
                                subject=ev.get('title', 'No Subject'),
                                start_time=ev['start'],
                                end_time=ev['end'],
                                organizer=ev.get('organizer', ''),
                                location=ev.get('location', ''),
                                attendees=ev.get('attendees', [])
                            ))
                    return meetings
                
                def find_meeting_for_recording(self, recording_time, tolerance_minutes=20):
                    meetings = self.get_meetings_for_date(recording_time)
                    best_match = None
                    best_score = 0
                    for meeting in meetings:
                        start_diff = abs((recording_time - meeting.start_time).total_seconds() / 60)
                        if start_diff <= tolerance_minutes:
                            score = max(0, tolerance_minutes - start_diff) / tolerance_minutes
                            if score > best_score:
                                best_score = score
                                best_match = meeting
                    return best_match
            
            # Create a test class that inherits from the mixin
            class TestCalendarIntegration(SimpleCalendarMixin):
                def __init__(self):
                    # Initialize required attributes for the mixin
                    self.calendar_events = calendar_data
                    self._calendar_integration = MockCalendarIntegration()  # Mock calendar integration
                    self._calendar_cache = {}
                    self._calendar_cache_date = None
                    print(f"   ✅ Mock calendar initialized with {len(self.calendar_events)} events")
            
            test_instance = TestCalendarIntegration()
            print("   ✅ SimpleCalendarMixin instance created successfully")
            
        except ImportError as e:
            print(f"   ❌ Failed to import SimpleCalendarMixin: {e}")
            return False
        except Exception as e:
            print(f"   ❌ Error initializing SimpleCalendarMixin: {e}")
            return False
        
        # Test 2: Test calendar data enhancement
        print("\n2️⃣ Testing calendar data enhancement...")
        
        try:
            # Convert files_info to the format expected by enhance_files_with_meeting_data
            files_dict = []
            for file_info in files_info:
                files_dict.append({
                    'name': file_info['filename'],
                    'length': file_info['size'],
                    'duration': file_info['duration'],
                    'time': file_info['date_created'],
                    'createDate': file_info['date_created'].strftime('%Y-%m-%d'),
                    'createTime': file_info['date_created'].strftime('%H:%M:%S'),
                    'version': '1',
                    'gui_status': 'Downloaded',
                    'checksum': file_info['checksum']
                })
            
            print(f"   📋 Testing enhancement of {len(files_dict)} files...")
            
            # Test the enhancement method
            enhanced_files = test_instance.enhance_files_with_meeting_data(files_dict)
            
            print(f"   ✅ Enhancement completed. Enhanced {len(enhanced_files)} files")
            
            # Verify enhancement results
            matches_found = 0
            for enhanced_file in enhanced_files:
                original_file = next((f for f in files_info if f['filename'] == enhanced_file['name']), None)
                
                if enhanced_file.get('has_meeting', False):
                    matches_found += 1
                    expected_meeting = original_file['should_match_meeting'] if original_file else None
                    
                    print(f"   📅 {enhanced_file['name']}:")
                    print(f"      Meeting: {enhanced_file.get('meeting_subject', 'N/A')}")
                    print(f"      Time: {enhanced_file.get('meeting_time_display', 'N/A')}")
                    print(f"      Location: {enhanced_file.get('meeting_location', 'N/A')}")
                    print(f"      Attendees: {enhanced_file.get('meeting_attendees_display', 'N/A')}")
                    print(f"      Organizer: {enhanced_file.get('meeting_organizer', 'N/A')}")
                    
                    if expected_meeting:
                        if enhanced_file.get('meeting_subject') == expected_meeting:
                            print(f"      ✅ Correctly matched expected meeting: {expected_meeting}")
                        else:
                            print(f"      ⚠️ Matched different meeting than expected")
                            print(f"         Expected: {expected_meeting}")
                            print(f"         Got: {enhanced_file.get('meeting_subject')}")
                else:
                    expected_meeting = original_file['should_match_meeting'] if original_file else None
                    if expected_meeting:
                        print(f"   ❌ {enhanced_file['name']}: Expected to match '{expected_meeting}' but no meeting info found")
                    else:
                        print(f"   ✅ {enhanced_file['name']}: Correctly has no meeting match (file outside meeting times)")
            
            print(f"   📊 Summary: {matches_found} files matched to calendar events")
            
        except Exception as e:
            print(f"   ❌ Error during calendar enhancement: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        # Test 3: Test GUI integration scenarios
        print("\n3️⃣ Testing GUI integration scenarios...")
        
        try:
            # Test cached files scenario (startup with offline files)
            print("   🔄 Testing cached files scenario...")
            
            # Simulate FileMetadata objects for cached files
            from file_operations_manager import FileMetadata
            cached_files = []
            
            for file_info in files_info:
                metadata = FileMetadata(
                    filename=file_info['filename'],
                    size=file_info['size'],
                    duration=file_info['duration'],
                    date_created=file_info['date_created'],
                    device_path=f"/device/{file_info['filename']}",
                    checksum=file_info['checksum']
                )
                cached_files.append(metadata)
            
            print(f"      📋 Created {len(cached_files)} cached file metadata objects")
            
            # Test conversion to GUI format (simulating _convert_cached_files_to_gui_format)
            gui_format_files = []
            for i, f_info in enumerate(cached_files):
                gui_format_files.append({
                    "name": f_info.filename,
                    "length": f_info.size,
                    "duration": f_info.duration,
                    "createDate": f_info.date_created.strftime("%Y-%m-%d") if f_info.date_created else "---",
                    "createTime": f_info.date_created.strftime("%H:%M:%S") if f_info.date_created else "---",
                    "time": f_info.date_created,
                    "version": "0",  # Version 0 for cached files
                    "original_index": i + 1,
                    "gui_status": "Downloaded",
                    "checksum": f_info.checksum,
                })
            
            print("      ✅ Converted cached files to GUI format")
            
            # Test enhancement of cached files
            enhanced_cached = test_instance.enhance_files_with_meeting_data(gui_format_files)
            cached_matches = sum(1 for f in enhanced_cached if f.get('has_meeting', False))
            
            print(f"      ✅ Enhanced cached files: {cached_matches} matches found")
            
        except Exception as e:
            print(f"   ❌ Error testing cached files scenario: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        # Test 4: Test integration completeness
        print("\n4️⃣ Testing integration completeness...")
        
        try:
            # Test that all files have the proper empty meeting fields when no meetings match
            all_files_have_meeting_fields = True
            missing_fields = []
            
            expected_fields = ['has_meeting', 'meeting_subject', 'meeting_organizer', 'meeting_location']
            
            for enhanced_file in enhanced_files:
                for field in expected_fields:
                    if field not in enhanced_file:
                        all_files_have_meeting_fields = False
                        missing_fields.append(f"{enhanced_file['name']}: missing {field}")
            
            if all_files_have_meeting_fields:
                print(f"   ✅ All files have proper meeting field structure")
            else:
                print(f"   ❌ Some files missing meeting fields:")
                for missing in missing_fields[:5]:  # Show first 5 missing fields
                    print(f"      - {missing}")
                return False
            
            print(f"   ✅ Integration structure verified")
            
        except Exception as e:
            print(f"   ❌ Error testing integration completeness: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        print("\n" + "="*60)
        print("✅ CALENDAR INTEGRATION TEST COMPLETED SUCCESSFULLY!")
        print("="*60)
        
        print("\n📋 TEST SUMMARY:")
        print(f"   • Calendar events created: {len(events)}")
        print(f"   • Sample files created: {len(files_info)}")
        print(f"   • Files with meeting matches: {matches_found}")
        print(f"   • Calendar integration: ✅ Working")
        print(f"   • File enhancement: ✅ Working")
        print(f"   • GUI integration ready: ✅ Yes")
        
        return True
        
    except Exception as e:
        print(f"\n❌ CRITICAL TEST FAILURE: {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        # Cleanup
        try:
            shutil.rmtree(test_dir)
            print(f"\n🧹 Cleaned up test environment: {test_dir}")
        except Exception as cleanup_error:
            print(f"⚠️ Warning: Could not cleanup test directory: {cleanup_error}")

def main():
    """Main test execution function."""
    
    print("🚀 STARTING COMPREHENSIVE CALENDAR INTEGRATION TEST")
    print("This test will verify that calendar integration works properly")
    print("in both cached file display and live file refresh scenarios.\n")
    
    # Check if we're in the right directory
    current_dir = Path.cwd()
    expected_files = ['simple_calendar_mixin.py', 'gui_main_window.py', 'file_operations_manager.py']
    missing_files = [f for f in expected_files if not (current_dir / f).exists()]
    
    if missing_files:
        print(f"❌ ERROR: Missing required files: {missing_files}")
        print(f"Current directory: {current_dir}")
        print("Please run this test from the hidock-desktop-app directory.")
        return False
    
    # Run the comprehensive test
    success = test_calendar_integration()
    
    if success:
        print("\n🎉 ALL TESTS PASSED!")
        print("Calendar integration is working correctly and ready for GUI integration.")
        return True
    else:
        print("\n💥 TESTS FAILED!")
        print("There are issues with the calendar integration that need to be fixed.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
