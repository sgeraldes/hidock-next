# oauth2_manager.py
"""
OAuth2 Manager - Handles OAuth2 Authentication Flow.

Implements the complete OAuth2 authorization code flow with PKCE for desktop applications.

Flow:
1. Generate PKCE code_verifier and code_challenge
2. Start local HTTP server on localhost:8080
3. Open browser to OAuth provider's authorization URL
4. User logs in and grants permissions
5. Browser redirects to http://localhost:8080/callback?code=...
6. Local server captures authorization code
7. Exchange code for access/refresh tokens
8. Store tokens securely
9. Shut down local server

Supports:
- Microsoft (Azure AD / Microsoft Identity Platform)
- Google (Google OAuth2)
"""

import webbrowser
from datetime import datetime, timedelta
from typing import Dict, Optional
from urllib.parse import urlencode

import requests

from config_and_logger import logger
from oauth2_pkce import generate_pkce_pair
from oauth2_providers import get_provider_config
from oauth2_server import OAuth2LocalServer


class OAuth2Manager:
    """
    Manages OAuth2 authentication flow for desktop applications.

    Usage:
        manager = OAuth2Manager('microsoft')
        tokens = manager.authorize()

        # tokens contains:
        # - access_token
        # - refresh_token
        # - expires_in
        # - scope
    """

    def __init__(self, provider: str, port: int = 8080):
        """
        Initialize OAuth2 manager.

        Args:
            provider: 'microsoft' or 'google'
            port: Localhost port for callback server (default 8080)
        """
        self.provider = provider
        self.config = get_provider_config(provider)
        self.port = port
        self.server: Optional[OAuth2LocalServer] = None

        logger.info("OAuth2Manager", "init", f"Initialized for {provider}")

    def authorize(self, timeout: int = 120) -> Dict:
        """
        Start OAuth2 authorization flow.

        This will:
        1. Start local callback server
        2. Open browser to provider's login page
        3. Wait for user to complete authentication
        4. Capture authorization code
        5. Exchange code for tokens
        6. Return tokens

        Args:
            timeout: Maximum time to wait for user (seconds, default 120)

        Returns:
            Dictionary containing:
            - access_token: Token for API calls
            - refresh_token: Token to get new access tokens
            - expires_in: Seconds until access_token expires
            - token_type: Usually "Bearer"
            - scope: Granted permissions
            - expires_at: Calculated expiry timestamp (ISO format)

        Raises:
            TimeoutError: If user doesn't complete auth within timeout
            Exception: If OAuth error occurs
        """
        try:
            logger.info("OAuth2Manager", "authorize", f"Starting authorization flow for {self.provider}")

            # Step 1: Generate PKCE codes
            code_verifier, code_challenge = generate_pkce_pair()
            logger.debug("OAuth2Manager", "authorize", "Generated PKCE codes")

            # Step 2: Start local callback server
            self.server = OAuth2LocalServer(port=self.port)
            self.server.start()
            redirect_uri = self.server.get_redirect_uri()
            logger.info("OAuth2Manager", "authorize", f"Callback server started: {redirect_uri}")

            # Step 3: Build authorization URL
            auth_url = self._build_authorization_url(code_challenge, redirect_uri)
            logger.info("OAuth2Manager", "authorize", "Opening browser for authentication")

            # Step 4: Open browser
            webbrowser.open(auth_url)

            # Step 5: Wait for callback
            logger.info("OAuth2Manager", "authorize", f"Waiting for callback (timeout: {timeout}s)")
            authorization_code = self.server.wait_for_code(timeout=timeout)
            logger.info("OAuth2Manager", "authorize", "Authorization code received")

            # Step 6: Exchange code for tokens
            logger.info("OAuth2Manager", "authorize", "Exchanging code for tokens")
            tokens = self._exchange_code_for_tokens(authorization_code, code_verifier, redirect_uri)

            # Add calculated expiry timestamp
            if "expires_in" in tokens:
                expiry_time = datetime.now() + timedelta(seconds=tokens["expires_in"])
                tokens["expires_at"] = expiry_time.isoformat()

            logger.info("OAuth2Manager", "authorize", "Authorization successful!")
            return tokens

        except TimeoutError:
            logger.error("OAuth2Manager", "authorize", "Authorization timeout")
            raise

        except Exception as e:
            logger.error("OAuth2Manager", "authorize", f"Authorization failed: {e}")
            raise

        finally:
            # Always stop the server
            if self.server:
                self.server.stop()

    def _build_authorization_url(self, code_challenge: str, redirect_uri: str) -> str:
        """
        Build OAuth2 authorization URL.

        Args:
            code_challenge: PKCE code challenge
            redirect_uri: Callback URL

        Returns:
            Complete authorization URL
        """
        params = {
            "client_id": self.config["client_id"],
            "response_type": self.config["response_type"],
            "redirect_uri": redirect_uri,
            "scope": self.config["scope"],
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }

        # Add provider-specific parameters
        if self.provider == "microsoft":
            params["response_mode"] = self.config.get("response_mode", "query")

        elif self.provider == "google":
            params["access_type"] = self.config.get("access_type", "offline")
            params["prompt"] = self.config.get("prompt", "consent")

        auth_url = f"{self.config['auth_url']}?{urlencode(params)}"

        logger.debug("OAuth2Manager", "build_url", f"Auth URL: {auth_url[:100]}...")
        return auth_url

    def _exchange_code_for_tokens(self, code: str, verifier: str, redirect_uri: str) -> Dict:
        """
        Exchange authorization code for access/refresh tokens.

        Args:
            code: Authorization code from callback
            verifier: PKCE code verifier
            redirect_uri: Must match the one used in authorization

        Returns:
            Token response dictionary

        Raises:
            Exception: If token exchange fails
        """
        token_url = self.config["token_url"]

        # Build token request
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": self.config["client_id"],
            "code_verifier": verifier,
        }

        # Google requires client_secret even for desktop apps
        if self.provider == "google" and "client_secret" in self.config:
            data["client_secret"] = self.config["client_secret"]

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
        }

        logger.debug("OAuth2Manager", "token_exchange", f"POST {token_url}")

        try:
            response = requests.post(token_url, data=data, headers=headers, timeout=30)
            response.raise_for_status()

            tokens = response.json()

            logger.info("OAuth2Manager", "token_exchange", "Token exchange successful")
            logger.debug(
                "OAuth2Manager",
                "token_exchange",
                f"Received: access_token ({len(tokens.get('access_token', ''))} chars), "
                f"refresh_token: {bool(tokens.get('refresh_token'))}",
            )

            return tokens

        except requests.exceptions.HTTPError as e:
            error_data = {}
            try:
                error_data = e.response.json()
            except:
                pass

            error_msg = error_data.get("error_description", error_data.get("error", str(e)))
            logger.error("OAuth2Manager", "token_exchange", f"HTTP error: {error_msg}")
            raise Exception(f"Token exchange failed: {error_msg}")

        except Exception as e:
            logger.error("OAuth2Manager", "token_exchange", f"Unexpected error: {e}")
            raise

    def refresh_access_token(self, refresh_token: str) -> Dict:
        """
        Refresh access token using refresh token.

        Args:
            refresh_token: Refresh token from previous authorization

        Returns:
            New token response with fresh access_token

        Raises:
            Exception: If refresh fails
        """
        token_url = self.config["token_url"]

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.config["client_id"],
        }

        # Google requires client_secret
        if self.provider == "google" and "client_secret" in self.config:
            data["client_secret"] = self.config["client_secret"]

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
        }

        logger.info("OAuth2Manager", "refresh", "Refreshing access token")

        try:
            response = requests.post(token_url, data=data, headers=headers, timeout=30)
            response.raise_for_status()

            tokens = response.json()

            # Add calculated expiry
            if "expires_in" in tokens:
                expiry_time = datetime.now() + timedelta(seconds=tokens["expires_in"])
                tokens["expires_at"] = expiry_time.isoformat()

            logger.info("OAuth2Manager", "refresh", "Token refreshed successfully")
            return tokens

        except Exception as e:
            logger.error("OAuth2Manager", "refresh", f"Refresh failed: {e}")
            raise Exception(f"Token refresh failed: {e}")


# Testing interface
if __name__ == "__main__":
    import sys

    from oauth2_providers import get_available_providers

    print("=== OAuth2 Manager - Test ===\n")

    # Check available providers
    available = get_available_providers()

    if not available:
        print("✗ No OAuth providers configured!")
        print("\nPlease add client_id to oauth2_providers.py")
        sys.exit(1)

    print(f"Available providers: {', '.join(available)}\n")

    # Select provider
    if len(available) == 1:
        provider = available[0]
        print(f"Using provider: {provider}\n")
    else:
        print("Select provider:")
        for i, p in enumerate(available, 1):
            print(f"  {i}. {p}")

        choice = input("\nChoice [1]: ").strip() or "1"
        provider = available[int(choice) - 1]
        print()

    # Start OAuth flow
    print(f"Starting OAuth2 flow for {provider}...")
    print("Your browser will open for authentication.\n")

    manager = OAuth2Manager(provider, port=8080)

    try:
        tokens = manager.authorize(timeout=120)

        print("\n" + "=" * 60)
        print("✓ AUTHORIZATION SUCCESSFUL!")
        print("=" * 60 + "\n")

        print("Tokens received:")
        print(f"  Access Token: {tokens['access_token'][:30]}...{tokens['access_token'][-10:]}")

        if "refresh_token" in tokens:
            print(f"  Refresh Token: {tokens['refresh_token'][:30]}...{tokens['refresh_token'][-10:]}")
        else:
            print("  Refresh Token: Not provided")

        print(f"  Expires In: {tokens.get('expires_in', 'N/A')} seconds")
        print(f"  Expires At: {tokens.get('expires_at', 'N/A')}")
        print(f"  Token Type: {tokens.get('token_type', 'N/A')}")
        print(f"  Scope: {tokens.get('scope', 'N/A')}")

        print("\n" + "=" * 60)
        print("\nYou can now use the access_token to make API calls!")

    except TimeoutError:
        print("\n✗ Authorization timeout!")
        print("User did not complete authentication within 2 minutes.")

    except Exception as e:
        print(f"\n✗ Authorization failed: {e}")
