#!/usr/bin/env python3
"""
Calendar Performance Testing Script

This script tests the performance of calendar data retrieval for different time periods
to validate the optimization strategy before implementation.

Usage:
    python test_calendar_performance.py
"""

import time
from datetime import datetime, timedelta
import sys
import os

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from simple_outlook_integration import create_simple_outlook_integration
    from config_and_logger import logger
except ImportError as e:
    print(f"Error importing modules: {e}")
    print("Make sure you're running this from the hidock-desktop-app directory")
    sys.exit(1)


def test_calendar_performance():
    """Test calendar retrieval performance for different time periods."""
    
    print("=== Calendar Performance Testing ===")
    print("Testing calendar retrieval for different time periods...\n")
    
    # Initialize calendar integration
    try:
        calendar_integration = create_simple_outlook_integration()
        
        if not calendar_integration.is_available():
            print(f"❌ Calendar integration not available: {calendar_integration.last_error}")
            print("\nPlease ensure:")
            print("• Outlook is installed and running")
            print("• You are connected to your mail server")
            print("• Calendar permissions are enabled")
            return False
            
        print(f"✅ Calendar integration available: {', '.join(calendar_integration.available_methods)}\n")
        
    except Exception as e:
        print(f"❌ Error initializing calendar integration: {e}")
        return False
    
    # Test cases: different time periods
    today = datetime.now().date()
    test_cases = [
        {
            'name': '1 Day (Today)',
            'start_date': today,
            'end_date': today,
            'expected_use_case': 'Single day file check'
        },
        {
            'name': '1 Week (This Week)', 
            'start_date': today - timedelta(days=today.weekday()),  # Monday of this week
            'end_date': today - timedelta(days=today.weekday()) + timedelta(days=6),  # Sunday
            'expected_use_case': 'Weekly file batch'
        },
        {
            'name': '2 Weeks (Current + Last Week)',
            'start_date': today - timedelta(days=today.weekday() + 7),  # Monday of last week
            'end_date': today - timedelta(days=today.weekday()) + timedelta(days=6),  # Sunday of this week
            'expected_use_case': 'Typical user file selection'
        },
        {
            'name': '1 Month (Last 30 Days)',
            'start_date': today - timedelta(days=30),
            'end_date': today,
            'expected_use_case': 'Large file selection or monthly sync'
        },
        {
            'name': '3 Months (Last 90 Days)',
            'start_date': today - timedelta(days=90),
            'end_date': today,
            'expected_use_case': 'Quarterly review or bulk processing'
        }
    ]
    
    results = []
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"Test {i}/5: {test_case['name']}")
        print(f"  Period: {test_case['start_date']} to {test_case['end_date']}")
        print(f"  Use Case: {test_case['expected_use_case']}")
        
        try:
            # Time the calendar retrieval
            start_time = time.time()
            
            meetings = calendar_integration.get_meetings_for_date_range(
                datetime.combine(test_case['start_date'], datetime.min.time()),
                datetime.combine(test_case['end_date'], datetime.max.time())
            )
            
            end_time = time.time()
            duration = end_time - start_time
            
            # Analyze results
            meeting_count = len(meetings) if meetings else 0
            days_span = (test_case['end_date'] - test_case['start_date']).days + 1
            meetings_per_day = meeting_count / days_span if days_span > 0 else 0
            
            result = {
                'test_case': test_case,
                'duration': duration,
                'meeting_count': meeting_count,
                'days_span': days_span,
                'meetings_per_day': meetings_per_day,
                'meetings_per_second': meeting_count / duration if duration > 0 else 0
            }
            results.append(result)
            
            print(f"  ✅ Duration: {duration:.2f} seconds")
            print(f"  📅 Meetings found: {meeting_count}")
            print(f"  📊 Meetings per day: {meetings_per_day:.1f}")
            print(f"  ⚡ Retrieval rate: {meeting_count / duration:.1f} meetings/second" if duration > 0 else "  ⚡ Retrieval rate: instant")
            print()
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
            print()
            continue
    
    # Performance analysis
    print("=== Performance Analysis ===")
    
    if not results:
        print("❌ No successful tests completed")
        return False
    
    # Find performance patterns
    print("\n📈 Performance Summary:")
    print(f"{'Test Case':<25} {'Duration (s)':<12} {'Meetings':<10} {'Days':<6} {'Rate (m/s)':<10}")
    print("-" * 70)
    
    for result in results:
        print(f"{result['test_case']['name']:<25} "
              f"{result['duration']:<12.2f} "
              f"{result['meeting_count']:<10} "
              f"{result['days_span']:<6} "
              f"{result['meetings_per_second']:<10.1f}")
    
    # Recommendations based on results
    print("\n💡 Performance Insights:")
    
    # Analyze if duration scales linearly with time period
    if len(results) >= 2:
        day_result = next((r for r in results if 'Day' in r['test_case']['name']), None)
        week_result = next((r for r in results if 'Week' in r['test_case']['name']), None)
        month_result = next((r for r in results if 'Month' in r['test_case']['name']), None)
        
        if day_result and week_result:
            week_vs_day_ratio = week_result['duration'] / day_result['duration'] if day_result['duration'] > 0 else float('inf')
            expected_ratio = week_result['days_span'] / day_result['days_span']
            
            if week_vs_day_ratio < expected_ratio * 0.8:  # Much better than linear
                print(f"  ✅ Weekly retrieval is efficient: {week_vs_day_ratio:.1f}x vs expected {expected_ratio:.1f}x")
                print("     → Batch retrieval has significant overhead savings")
            elif week_vs_day_ratio > expected_ratio * 1.2:  # Worse than linear
                print(f"  ⚠️  Weekly retrieval scales poorly: {week_vs_day_ratio:.1f}x vs expected {expected_ratio:.1f}x")
                print("     → Consider daily chunking for large periods")
            else:
                print(f"  📊 Weekly retrieval scales linearly: {week_vs_day_ratio:.1f}x vs expected {expected_ratio:.1f}x")
        
        if month_result:
            if month_result['duration'] < 10.0:  # Arbitrary threshold
                print(f"  ✅ Monthly retrieval is fast enough: {month_result['duration']:.2f}s")
                print("     → Can use large date ranges for optimization")
            elif month_result['duration'] < 30.0:
                print(f"  ⚠️  Monthly retrieval is moderate: {month_result['duration']:.2f}s")
                print("     → Consider weekly chunking for better user experience")
            else:
                print(f"  ❌ Monthly retrieval is slow: {month_result['duration']:.2f}s")
                print("     → Must use smaller chunks (weekly or daily)")
    
    # Optimization recommendations
    print("\n🚀 Optimization Strategy Recommendations:")
    
    fastest_result = min(results, key=lambda r: r['duration'])
    slowest_result = max(results, key=lambda r: r['duration'])
    
    if fastest_result['duration'] < 2.0:
        print(f"  ✅ Fast retrieval detected (best: {fastest_result['duration']:.2f}s)")
        print("     → Batch optimization strategy is viable")
        
        if slowest_result['duration'] < 10.0:
            print(f"  ✅ Even large periods are acceptable ({slowest_result['duration']:.2f}s)")
            print("     → Can use aggressive date range batching")
        else:
            optimal_period = next((r for r in results if r['duration'] < 5.0), week_result)
            if optimal_period:
                print(f"  💡 Optimal chunking period: {optimal_period['test_case']['name']} ({optimal_period['duration']:.2f}s)")
                print(f"     → Chunk large date ranges into {optimal_period['days_span']}-day periods")
    else:
        print(f"  ⚠️  Calendar API is slow (fastest: {fastest_result['duration']:.2f}s)")
        print("     → Batch optimization still valuable, but set user expectations")
        print("     → Consider background pre-caching")
    
    # Final recommendation
    print("\n✨ Implementation Guidance:")
    avg_duration = sum(r['duration'] for r in results) / len(results)
    
    if avg_duration < 3.0:
        print("  🟢 GREEN LIGHT: Implement batch optimization immediately")
        print(f"     → Expected 10-20x performance improvement for multi-file operations")
    elif avg_duration < 8.0:
        print("  🟡 YELLOW LIGHT: Implement with chunking strategy")
        print(f"     → Still 5-10x improvement, but add progress indicators")
    else:
        print("  🔴 RED LIGHT: Calendar API too slow for real-time batch operations")
        print(f"     → Consider background caching and async operations")
    
    return True


def test_individual_vs_batch_comparison():
    """Compare individual file checking vs batch checking performance."""
    
    print("\n=== Individual vs Batch Comparison ===")
    
    try:
        calendar_integration = create_simple_outlook_integration()
        if not calendar_integration.is_available():
            print("❌ Calendar integration not available")
            return
        
        # Simulate 5 files from the same week
        today = datetime.now()
        test_dates = [
            today - timedelta(days=4),  # 4 days ago
            today - timedelta(days=3),  # 3 days ago  
            today - timedelta(days=2),  # 2 days ago
            today - timedelta(days=1),  # Yesterday
            today,                      # Today
        ]
        
        print(f"Testing with 5 simulated files from {test_dates[0].date()} to {test_dates[-1].date()}")
        
        # Method 1: Individual queries (current implementation)
        print("\n🔍 Method 1: Individual Queries (Current)")
        start_time = time.time()
        
        individual_results = []
        for i, date in enumerate(test_dates):
            query_start = time.time()
            meetings = calendar_integration.get_meetings_for_date(date)
            query_duration = time.time() - query_start
            individual_results.append({
                'date': date,
                'duration': query_duration,
                'meetings': len(meetings) if meetings else 0
            })
            print(f"  File {i+1}: {query_duration:.2f}s ({len(meetings) if meetings else 0} meetings)")
        
        individual_total_time = time.time() - start_time
        individual_total_meetings = sum(r['meetings'] for r in individual_results)
        
        print(f"  Total: {individual_total_time:.2f}s, {individual_total_meetings} meetings")
        
        # Method 2: Batch query (proposed implementation)  
        print("\n🚀 Method 2: Batch Query (Proposed)")
        start_time = time.time()
        
        start_date = min(test_dates)
        end_date = max(test_dates)
        all_meetings = calendar_integration.get_meetings_for_date_range(start_date, end_date)
        
        batch_total_time = time.time() - start_time
        batch_total_meetings = len(all_meetings) if all_meetings else 0
        
        print(f"  Single query: {batch_total_time:.2f}s ({batch_total_meetings} meetings)")
        
        # Analysis
        print(f"\n📊 Performance Comparison:")
        print(f"  Individual method: {individual_total_time:.2f}s")
        print(f"  Batch method:      {batch_total_time:.2f}s")
        
        if batch_total_time > 0:
            improvement = individual_total_time / batch_total_time
            print(f"  Improvement:       {improvement:.1f}x faster")
            
            if improvement > 3.0:
                print(f"  🎉 EXCELLENT: {improvement:.1f}x performance gain validates batch strategy!")
            elif improvement > 1.5:
                print(f"  ✅ GOOD: {improvement:.1f}x improvement justifies implementation")
            else:
                print(f"  ⚠️  MARGINAL: Only {improvement:.1f}x improvement - reconsider strategy")
        else:
            print(f"  ⚡ Batch query was instantaneous!")
            
        # Data consistency check
        if individual_total_meetings == batch_total_meetings:
            print(f"  ✅ Data consistency: Both methods found {individual_total_meetings} meetings")
        else:
            print(f"  ⚠️  Data mismatch: Individual={individual_total_meetings}, Batch={batch_total_meetings}")
            print("     → May need to investigate date range boundaries")
            
    except Exception as e:
        print(f"❌ Comparison test failed: {e}")


if __name__ == "__main__":
    print("Starting calendar performance testing...\n")
    
    success = test_calendar_performance()
    
    if success:
        test_individual_vs_batch_comparison()
        
        print("\n" + "="*50)
        print("Performance testing complete!")
        print("Use these results to guide the optimization implementation.")
    else:
        print("❌ Performance testing failed. Check calendar integration setup.")
        sys.exit(1)
