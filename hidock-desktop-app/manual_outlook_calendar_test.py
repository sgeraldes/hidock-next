#!/usr/bin/env python3
"""
Manual Integration Test for Outlook Calendar

This script allows you to manually test the Outlook Calendar integration functionality
without the main GUI. It will guide you through the setup and authentication process.

⚠️  NOTE: This is a MANUAL integration test, not an automated unit test.
    For automated unit tests, see tests/test_outlook_calendar_service.py

Prerequisites:
1. Install O365 library: pip install O365[calendar]
2. Create Azure AD Application (see CALENDAR_INTEGRATION_TEST_SETUP.md)
3. Have access to Microsoft 365/Outlook calendar

Usage:
    python manual_outlook_calendar_test.py
"""

import sys
import os
from datetime import datetime, timedelta
import traceback

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config_and_logger import ConfigManager, logger
from outlook_calendar_service import OutlookCalendarService, OUTLOOK_AVAILABLE


class OutlookCalendarTester:
    """Test class for Outlook Calendar integration."""
    
    def __init__(self):
        self.config_manager = ConfigManager()
        self.outlook_service = OutlookCalendarService(self.config_manager)
        
    def check_prerequisites(self):
        """Check if all prerequisites are met."""
        print("🔍 Checking prerequisites...")
        
        # Check O365 library
        if not OUTLOOK_AVAILABLE:
            print("❌ O365 library not available")
            print("   Install with: pip install O365[calendar]")
            return False
        print("✅ O365 library is available")
        
        # Check service availability
        if not self.outlook_service.is_available():
            print("❌ Outlook service not available")
            return False
        print("✅ Outlook service is available")
        
        print("✅ All prerequisites met!")
        return True
    
    def get_credentials_from_user(self):
        """Get Azure AD credentials from user."""
        print("\n🔑 Azure AD Application Credentials")
        print("=" * 50)
        print("You need to create an Azure AD application first.")
        print("See the setup instructions at the top of this script.")
        print()
        
        client_id = input("Enter your Azure AD Client ID: ").strip()
        if not client_id:
            print("❌ Client ID is required")
            return None, None, None
            
        client_secret = input("Enter your Azure AD Client Secret: ").strip()
        if not client_secret:
            print("❌ Client Secret is required")
            return None, None, None
            
        tenant_id = input("Enter your Tenant ID (or press Enter for 'common'): ").strip()
        if not tenant_id:
            tenant_id = "common"
            
        return client_id, client_secret, tenant_id
    
    def test_authentication(self, client_id, client_secret, tenant_id):
        """Test authentication with provided credentials."""
        print(f"\n🔐 Testing authentication...")
        print(f"   Client ID: {client_id[:8]}...")
        print(f"   Tenant ID: {tenant_id}")
        
        try:
            # Enable integration for testing
            self.config_manager.set("outlook_integration_enabled", True)
            
            # Attempt authentication
            success = self.outlook_service.authenticate(client_id, client_secret, tenant_id)
            
            if success:
                print("✅ Authentication successful!")
                print("   Your browser should have opened for Microsoft login.")
                print("   Please complete the login process if it hasn't been done.")
                return True
            else:
                print("❌ Authentication failed")
                return False
                
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            traceback.print_exc()
            return False
    
    def test_connection(self):
        """Test the connection to Microsoft Graph."""
        print("\n🌐 Testing connection to Microsoft Graph...")
        
        if not self.outlook_service.is_authenticated():
            print("❌ Not authenticated. Cannot test connection.")
            return False
            
        try:
            if self.outlook_service.test_connection():
                print("✅ Connection test successful!")
                return True
            else:
                print("❌ Connection test failed")
                return False
        except Exception as e:
            print(f"❌ Connection error: {e}")
            return False
    
    def test_calendar_access(self):
        """Test calendar access and retrieve meetings."""
        print("\n📅 Testing calendar access...")
        
        if not self.outlook_service.is_authenticated():
            print("❌ Not authenticated. Cannot access calendar.")
            return False
            
        try:
            # Get meetings for the next 7 days
            start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = start_date + timedelta(days=7)
            
            print(f"   Fetching meetings from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
            
            meetings = self.outlook_service.get_meetings_for_date_range(start_date, end_date)
            
            print(f"✅ Retrieved {len(meetings)} meetings from your calendar")
            
            # Display meeting details
            if meetings:
                print("\n📋 Your upcoming meetings:")
                print("-" * 80)
                for i, meeting in enumerate(meetings[:5], 1):  # Show first 5 meetings
                    print(f"{i}. {meeting.subject}")
                    print(f"   📅 {meeting.start_time} - {meeting.end_time}")
                    print(f"   👤 Organizer: {meeting.organizer}")
                    print(f"   👥 Attendees: {len(meeting.attendees)}")
                    if meeting.location:
                        print(f"   📍 Location: {meeting.location}")
                    if meeting.is_teams_meeting:
                        print(f"   💻 Teams Meeting: {meeting.meeting_url}")
                    print()
                    
                if len(meetings) > 5:
                    print(f"   ... and {len(meetings) - 5} more meetings")
            else:
                print("   No meetings found in the specified date range")
                
            return True
            
        except Exception as e:
            print(f"❌ Calendar access error: {e}")
            traceback.print_exc()
            return False
    
    def test_meeting_correlation(self):
        """Test meeting correlation functionality."""
        print("\n🔍 Testing meeting correlation...")
        
        if not self.outlook_service.is_authenticated():
            print("❌ Not authenticated. Cannot test correlation.")
            return False
            
        try:
            # Test with current time
            test_time = datetime.now()
            print(f"   Testing correlation for audio file at: {test_time}")
            
            meeting = self.outlook_service.find_meeting_for_audio_file(test_time)
            
            if meeting:
                print(f"✅ Found matching meeting: '{meeting.subject}'")
                print(f"   📅 Meeting time: {meeting.start_time} - {meeting.end_time}")
                print(f"   👤 Organizer: {meeting.organizer}")
                return True
            else:
                print("ℹ️  No meeting found for current time (this is normal if you don't have a meeting right now)")
                
                # Test with a future meeting if available
                start_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                end_date = start_date + timedelta(days=7)
                meetings = self.outlook_service.get_meetings_for_date_range(start_date, end_date)
                
                if meetings:
                    test_meeting = meetings[0]
                    print(f"   Testing with your next meeting: '{test_meeting.subject}'")
                    
                    # Test correlation with meeting start time
                    correlated_meeting = self.outlook_service.find_meeting_for_audio_file(test_meeting.start_time)
                    
                    if correlated_meeting and correlated_meeting.event_id == test_meeting.event_id:
                        print("✅ Meeting correlation algorithm working correctly!")
                    else:
                        print("⚠️  Meeting correlation might have issues")
                
                return True
                
        except Exception as e:
            print(f"❌ Meeting correlation error: {e}")
            traceback.print_exc()
            return False
    
    def show_status(self):
        """Show current integration status."""
        print("\n📊 Current Status:")
        status = self.outlook_service.get_status_info()
        
        for key, value in status.items():
            icon = "✅" if "Yes" in value or "successful" in value.lower() else "❌" if "No" in value else "ℹ️"
            print(f"   {icon} {key.replace('_', ' ').title()}: {value}")
    
    def cleanup_test_data(self):
        """Clean up test data."""
        print("\n🧹 Cleaning up test data...")
        try:
            # Clear cache
            self.outlook_service.clear_cache()
            print("✅ Cache cleared")
            
            # Ask if user wants to remove saved credentials
            choice = input("\nDo you want to remove saved credentials? (y/N): ").strip().lower()
            if choice == 'y':
                # Remove outlook credentials from config
                if self.config_manager.get("outlook_credentials"):
                    # Don't actually remove - just disable for testing
                    self.config_manager.set("outlook_integration_enabled", False)
                    print("✅ Integration disabled (credentials kept for future use)")
                else:
                    print("ℹ️  No saved credentials to remove")
            
        except Exception as e:
            print(f"⚠️  Cleanup error: {e}")
    
    def run_interactive_test(self):
        """Run interactive test with user prompts."""
        print("🚀 HiDock Outlook Calendar Integration Test")
        print("=" * 60)
        
        # Check prerequisites
        if not self.check_prerequisites():
            return False
        
        # Check if already authenticated
        if self.config_manager.get("outlook_integration_enabled") and self.outlook_service.auto_authenticate():
            print("\n✅ Found saved credentials - auto-authentication successful!")
            
            choice = input("Use saved credentials? (Y/n): ").strip().lower()
            if choice not in ['n', 'no']:
                authenticated = True
            else:
                # Get new credentials
                client_id, client_secret, tenant_id = self.get_credentials_from_user()
                if not all([client_id, client_secret, tenant_id]):
                    print("❌ Invalid credentials provided")
                    return False
                authenticated = self.test_authentication(client_id, client_secret, tenant_id)
        else:
            # Get credentials from user
            client_id, client_secret, tenant_id = self.get_credentials_from_user()
            if not all([client_id, client_secret, tenant_id]):
                print("❌ Invalid credentials provided")
                return False
            authenticated = self.test_authentication(client_id, client_secret, tenant_id)
        
        if not authenticated:
            print("\n❌ Authentication failed. Cannot continue with tests.")
            return False
        
        # Run tests
        print("\n🧪 Running integration tests...")
        
        tests = [
            ("Connection Test", self.test_connection),
            ("Calendar Access Test", self.test_calendar_access),
            ("Meeting Correlation Test", self.test_meeting_correlation)
        ]
        
        results = {}
        for test_name, test_func in tests:
            print(f"\n{'='*60}")
            try:
                results[test_name] = test_func()
            except Exception as e:
                print(f"❌ {test_name} failed with exception: {e}")
                traceback.print_exc()
                results[test_name] = False
        
        # Show final status
        self.show_status()
        
        # Show test summary
        print(f"\n🏁 Test Summary:")
        print("=" * 60)
        for test_name, result in results.items():
            icon = "✅" if result else "❌"
            print(f"{icon} {test_name}: {'PASSED' if result else 'FAILED'}")
        
        success_count = sum(results.values())
        total_tests = len(results)
        print(f"\nOverall: {success_count}/{total_tests} tests passed")
        
        # Cleanup
        choice = input("\nRun cleanup? (y/N): ").strip().lower()
        if choice == 'y':
            self.cleanup_test_data()
        
        return success_count == total_tests


def main():
    """Main test function."""
    try:
        tester = OutlookCalendarTester()
        success = tester.run_interactive_test()
        
        if success:
            print("\n🎉 All tests passed! Outlook Calendar integration is working correctly.")
        else:
            print("\n⚠️  Some tests failed. Check the output above for details.")
        
        return 0 if success else 1
        
    except KeyboardInterrupt:
        print("\n\n⏹️  Test interrupted by user")
        return 1
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
