#!/usr/bin/env python3
"""
Analyze authentication flow in HAR file
"""

import json
import re


def analyze_auth():
    with open("archive/hinotes.hidock.com.har", "r", encoding="utf-8") as f:
        har_data = json.load(f)

    # Redacted - this was used for protocol analysis only
    # If you need to run this analysis, extract token from your own HAR file
    token = "[REDACTED - Extract from your own HAR file]"

    # Find authentication-related requests
    print("=== AUTHENTICATION ANALYSIS ===\n")

    # 1. Find where token is first used
    print("1. Token usage analysis:")
    first_token_use = None

    for i, entry in enumerate(har_data["log"]["entries"]):
        request = entry["request"]

        # Check if token is used in headers
        for header in request["headers"]:
            if token in header.get("value", ""):
                if first_token_use is None:
                    first_token_use = i
                print(f"   Token used in request {i}: {request['url']}")
                break

    print(f"\nFirst token usage at request {first_token_use}")

    # 2. Analyze auth chunk
    print("\n2. Authentication JavaScript analysis:")
    for entry in har_data["log"]["entries"]:
        if "auth.7604887c.js" in entry["request"]["url"]:
            auth_content = entry["response"]["content"]["text"]

            # Look for Google OAuth patterns
            google_patterns = [
                r"122776600569-[a-z0-9]+\.apps\.googleusercontent\.com",
                r"AIzaSy[a-zA-Z0-9_-]+",
                r'client_id["\s]*:["\s]*[^"]+',
                r"gapi\.[a-zA-Z.]+",
                r"google\.accounts\.oauth2",
            ]

            for pattern in google_patterns:
                matches = re.findall(pattern, auth_content)
                if matches:
                    print(f"   Google OAuth pattern '{pattern}': {len(matches)} matches")
                    for match in matches[:3]:  # Show first 3 matches
                        print(f"     - {match}")

            # Check if token is hardcoded
            if token in auth_content:
                print("   *** TOKEN IS HARDCODED IN AUTH.JS ***")
            else:
                print("   Token not found in auth.js")

            print(f"   Auth file size: {len(auth_content):,} characters")
            break

    # 3. Check for login endpoints
    print("\n3. Login endpoint analysis:")
    login_endpoints = set()

    for entry in har_data["log"]["entries"]:
        url = entry["request"]["url"]
        if any(keyword in url.lower() for keyword in ["login", "auth", "oauth", "signin"]):
            login_endpoints.add(url)

    if login_endpoints:
        for endpoint in login_endpoints:
            print(f"   - {endpoint}")
    else:
        print("   No explicit login endpoints found")

    # 4. Check for Google OAuth flow
    print("\n4. Google OAuth flow analysis:")
    google_requests = []

    for i, entry in enumerate(har_data["log"]["entries"]):
        url = entry["request"]["url"]
        if "google" in url.lower() and ("oauth" in url.lower() or "auth" in url.lower() or "accounts" in url.lower()):
            google_requests.append((i, url, entry["response"]["status"]))

    if google_requests:
        for i, url, status in google_requests:
            print(f"   Request {i}: {url} -> Status {status}")
    else:
        print("   No Google OAuth requests found")

    # 5. Look for token exchange endpoints
    print("\n5. Token exchange analysis:")

    # Check responses for token-like patterns
    token_responses = []
    for i, entry in enumerate(har_data["log"]["entries"]):
        response_text = entry["response"]["content"].get("text", "")
        if response_text and ("access" in response_text.lower() or "token" in response_text.lower()):
            if len(response_text) < 10000:  # Skip large files
                # Look for JSON responses that might contain tokens
                try:
                    if response_text.strip().startswith("{"):
                        data = json.loads(response_text)
                        if any(key in data for key in ["access_token", "accessToken", "token", "auth"]):
                            token_responses.append((i, entry["request"]["url"]))
                except:
                    pass

    if token_responses:
        for i, url in token_responses:
            print(f"   Request {i}: {url}")
    else:
        print("   No token exchange responses found")

    return token


if __name__ == "__main__":
    analyze_auth()
