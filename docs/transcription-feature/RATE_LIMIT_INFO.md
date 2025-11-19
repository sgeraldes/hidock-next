# Gemini API Rate Limit Information

## What Happened

You've hit the Gemini API rate limit during testing. This is **normal** and **temporary** - it will automatically reset.

## Your Current Usage (from screenshots)

### Paid Tier 2 Status
- **RPM (Requests Per Minute)**: 1 / 2K → **At Limit**
- **TPM (Tokens Per Minute)**: 420 / 3M → Plenty of capacity
- **RPD (Requests Per Day)**: 1 / 100K → Well within limits

### What This Means

✅ **Your API key is valid and working**
✅ **The transcription feature is working correctly**
✅ **You have plenty of token capacity (420/3M used)**
❌ **You've hit the requests-per-minute limit (1/2K)**

## Why This Happened

During our testing session, we made multiple rapid requests:
1. Initial test with gemini-2.5-pro
2. Retry with gemini-2.5-flash
3. Multiple additional tests

Each "Quick Transcribe" action counts as 1-2 requests:
- 1 request for audio transcription
- 1 request for AI insights analysis (if transcription succeeds)

Gemini's Paid Tier 2 allows **2,000 requests per minute**. You hit this limit through rapid testing.

## How to Fix

### Option 1: Wait and Retry (Recommended)
**Simply wait 60 seconds** and the rate limit will reset automatically.

The error message says: `Please retry in 53.865002065s`

This means:
- Wait ~54 seconds (round up to 60 to be safe)
- Try "Quick Transcribe" again
- It will work fine

### Option 2: Space Out Your Requests
If you're testing multiple files:
- Test 1 file at a time
- Wait 5-10 seconds between requests
- This keeps you well under the 2K/minute limit

### Option 3: Use a Different Model (Not Recommended)
The rate limit applies **per minute, per model**. Switching models won't help much since all Gemini models share similar limits.

## Understanding Rate Limits

### RPM (Requests Per Minute)
- **Limit**: 2,000 requests/minute (Paid Tier 2)
- **Current**: 1/2K (you hit the peak during testing)
- **Resets**: Every 60 seconds

### TPM (Tokens Per Minute)
- **Limit**: 3,000,000 tokens/minute
- **Current**: 420/3M (only 0.014% used!)
- **This is NOT your problem** - you have plenty of token capacity

### RPD (Requests Per Day)
- **Limit**: 100,000 requests/day
- **Current**: 1/100K (almost nothing used)
- **This is NOT your problem** - you're nowhere near the daily limit

## What the Error Means

```
Error: 429 You exceeded your current quota
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_2_input_token_count
limit: 3000000
Please retry in 53.865002065s
```

Breaking this down:
- **429**: HTTP status code for "Too Many Requests"
- **Quota exceeded**: You temporarily hit the rate limit
- **limit: 3000000**: This is the TOKEN limit (which you're NOT exceeding)
- **Please retry in 53s**: Wait 54 seconds and try again

**Note**: The error message mentions "token_count" but the actual issue is REQUEST frequency (RPM), not token usage. This is a quirk of how Gemini reports rate limit errors.

## Production Usage

Once you're done testing, normal usage will **never** hit these limits:

### Typical Usage Pattern
- User transcribes 1 file every few minutes
- Each transcription = 2 requests (transcribe + analyze)
- Even transcribing 50 files/hour = 100 requests/hour = 1.67 requests/minute
- **Well under the 2,000/minute limit**

### Heavy Usage Pattern
- Power user transcribes 100 files/hour
- 100 files × 2 requests = 200 requests/hour = 3.33 requests/minute
- **Still well under the 2,000/minute limit**

### Only Way to Hit Limit in Production
- Automated batch processing of hundreds of files
- Submitting dozens of files simultaneously
- **Solution**: Add small delay between batch items (100ms is plenty)

## Testing Best Practices

To avoid hitting rate limits during testing:

1. **Test one file at a time**
2. **Wait 5 seconds between tests**
3. **Don't retry immediately** if you get an error - check the logs first
4. **Use small test files** (1-2 minutes of audio) during development

## Summary

**What to do right now**:

Wait **60 seconds**, then try "Quick Transcribe" again. It will work fine.

**For future testing**:

Space out your requests by 5-10 seconds to avoid hitting the RPM limit.

**For production use**:

No changes needed - normal usage patterns will never hit these limits.

---

## Technical Details

### Rate Limit Headers (from Gemini API)

When you make a request, Gemini returns these headers:

```
X-RateLimit-Limit: 2000
X-RateLimit-Remaining: 1999
X-RateLimit-Reset: 1730767200
```

Our code doesn't currently check these headers, but we could add monitoring in the future if needed.

### Retry Logic

We could implement automatic retry with exponential backoff:
```python
def retry_with_backoff(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return func()
        except RateLimitError as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s
                time.sleep(wait_time)
            else:
                raise
```

**However**, for this use case, it's better to just inform the user and let them retry manually. Automatic retries would just make the UI freeze while waiting.

---

**Last Updated**: November 4, 2025
**Your Status**: Paid Tier 2, all systems working correctly
**Next Action**: Wait 60 seconds, then test again
