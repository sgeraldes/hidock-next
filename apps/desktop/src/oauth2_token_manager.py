# oauth2_token_manager.py
"""
OAuth2 Token Manager - Secure Token Storage and Management.

Handles secure storage, retrieval, and refreshing of OAuth2 tokens.
Uses Fernet encryption (same as AI API keys) to protect tokens at rest.

Features:
- Encrypted token storage
- Token expiry checking
- Automatic token refresh
- Multiple provider support (Microsoft, Google, etc.)
- Thread-safe operations
"""

import base64
import json
import os
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional

from config_and_logger import logger
from oauth2_manager import OAuth2Manager


class OAuth2TokenManager:
    """
    Manages OAuth2 tokens with secure storage and automatic refresh.

    Usage:
        manager = OAuth2TokenManager()

        # Save tokens after OAuth flow
        manager.save_tokens('microsoft', tokens)

        # Load tokens later
        tokens = manager.load_tokens('microsoft')

        # Check if token is valid
        if manager.is_token_valid('microsoft'):
            access_token = manager.get_access_token('microsoft')
        else:
            # Need to re-authenticate
            pass
    """

    def __init__(self, config_dir: Optional[str] = None):
        """
        Initialize OAuth2 token manager.

        Args:
            config_dir: Directory for storing tokens and encryption key.
                       Defaults to ../config relative to this file.
        """
        if config_dir is None:
            # Default to config directory (same as hidock_config.json)
            script_dir = os.path.dirname(os.path.abspath(__file__))
            app_root = os.path.dirname(script_dir)
            config_dir = os.path.join(app_root, "config")

        self.config_dir = config_dir
        self.tokens_file = os.path.join(config_dir, "oauth2_tokens.json")
        self.key_file = os.path.join(config_dir, ".hidock_key.dat")

        # Thread lock for thread-safe operations
        self._lock = threading.Lock()

        # Ensure config directory exists
        os.makedirs(config_dir, exist_ok=True)

        # Initialize or load encryption key
        self._ensure_encryption_key()

        logger.info("OAuth2TokenManager", "init", f"Initialized with config_dir: {config_dir}")

    def _ensure_encryption_key(self):
        """Ensure encryption key exists, create if missing."""
        try:
            from cryptography.fernet import Fernet
        except ImportError:
            logger.error("OAuth2TokenManager", "_ensure_encryption_key", "cryptography package not installed")
            raise ImportError("cryptography package required for token encryption")

        if os.path.exists(self.key_file):
            # Load existing key
            with open(self.key_file, "rb") as f:
                self.encryption_key = f.read()
            logger.debug("OAuth2TokenManager", "_ensure_encryption_key", "Loaded existing encryption key")
        else:
            # Generate new key
            self.encryption_key = Fernet.generate_key()
            with open(self.key_file, "wb") as f:
                f.write(self.encryption_key)
            logger.info("OAuth2TokenManager", "_ensure_encryption_key", "Generated new encryption key")

    def _encrypt(self, data: str) -> str:
        """
        Encrypt data using Fernet.

        Args:
            data: Plain text string to encrypt

        Returns:
            Base64-encoded encrypted string
        """
        try:
            from cryptography.fernet import Fernet

            f = Fernet(self.encryption_key)
            encrypted_bytes = f.encrypt(data.encode())
            encrypted_str = base64.b64encode(encrypted_bytes).decode()
            return encrypted_str
        except Exception as e:
            logger.error("OAuth2TokenManager", "_encrypt", f"Encryption error: {e}")
            raise

    def _decrypt(self, encrypted_data: str) -> str:
        """
        Decrypt data using Fernet.

        Args:
            encrypted_data: Base64-encoded encrypted string

        Returns:
            Decrypted plain text string
        """
        try:
            from cryptography.fernet import Fernet

            f = Fernet(self.encryption_key)
            encrypted_bytes = base64.b64decode(encrypted_data.encode())
            decrypted_bytes = f.decrypt(encrypted_bytes)
            return decrypted_bytes.decode()
        except Exception as e:
            logger.error("OAuth2TokenManager", "_decrypt", f"Decryption error: {e}")
            raise

    def save_tokens(self, provider: str, tokens: Dict) -> bool:
        """
        Save OAuth2 tokens for a provider (encrypted).

        Args:
            provider: Provider name ('microsoft', 'google', etc.)
            tokens: Token dictionary containing:
                - access_token: Access token
                - refresh_token: Refresh token (optional)
                - expires_in: Seconds until expiry
                - token_type: Usually "Bearer"
                - scope: Granted scopes

        Returns:
            True if saved successfully, False otherwise
        """
        with self._lock:
            try:
                # Load existing tokens
                all_tokens = self._load_tokens_file()

                # Add timestamp for expiry calculation
                if "expires_in" in tokens:
                    expiry_time = datetime.now() + timedelta(seconds=tokens["expires_in"])
                    tokens["expires_at"] = expiry_time.isoformat()

                # Store timestamp of when tokens were saved
                tokens["saved_at"] = datetime.now().isoformat()

                # Encrypt sensitive fields
                encrypted_tokens = tokens.copy()
                if "access_token" in encrypted_tokens:
                    encrypted_tokens["access_token"] = self._encrypt(encrypted_tokens["access_token"])
                if "refresh_token" in encrypted_tokens:
                    encrypted_tokens["refresh_token"] = self._encrypt(encrypted_tokens["refresh_token"])

                # Save to all_tokens
                all_tokens[provider] = encrypted_tokens

                # Write to file
                self._save_tokens_file(all_tokens)

                logger.info(
                    "OAuth2TokenManager",
                    "save_tokens",
                    f"Saved tokens for {provider} (expires: {tokens.get('expires_at', 'N/A')})",
                )
                return True

            except Exception as e:
                logger.error("OAuth2TokenManager", "save_tokens", f"Error saving tokens: {e}")
                return False

    def load_tokens(self, provider: str) -> Optional[Dict]:
        """
        Load OAuth2 tokens for a provider (decrypted).

        Args:
            provider: Provider name ('microsoft', 'google', etc.)

        Returns:
            Token dictionary if found, None otherwise
        """
        with self._lock:
            try:
                all_tokens = self._load_tokens_file()

                if provider not in all_tokens:
                    logger.debug("OAuth2TokenManager", "load_tokens", f"No tokens found for {provider}")
                    return None

                encrypted_tokens = all_tokens[provider]

                # Decrypt sensitive fields
                tokens = encrypted_tokens.copy()
                if "access_token" in tokens:
                    tokens["access_token"] = self._decrypt(tokens["access_token"])
                if "refresh_token" in tokens:
                    tokens["refresh_token"] = self._decrypt(tokens["refresh_token"])

                logger.debug("OAuth2TokenManager", "load_tokens", f"Loaded tokens for {provider}")
                return tokens

            except Exception as e:
                logger.error("OAuth2TokenManager", "load_tokens", f"Error loading tokens: {e}")
                return None

    def _load_tokens_file(self) -> Dict:
        """Load tokens from JSON file."""
        if not os.path.exists(self.tokens_file):
            return {}

        try:
            with open(self.tokens_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(
                "OAuth2TokenManager", "_load_tokens_file", f"Error reading tokens file: {e}, returning empty dict"
            )
            return {}

    def _save_tokens_file(self, all_tokens: Dict):
        """Save tokens to JSON file."""
        try:
            with open(self.tokens_file, "w", encoding="utf-8") as f:
                json.dump(all_tokens, f, indent=2)
        except IOError as e:
            logger.error("OAuth2TokenManager", "_save_tokens_file", f"Error writing tokens file: {e}")
            raise

    def is_token_valid(self, provider: str) -> bool:
        """
        Check if access token is still valid (not expired).

        Args:
            provider: Provider name

        Returns:
            True if token exists and is valid, False otherwise
        """
        tokens = self.load_tokens(provider)
        if not tokens:
            return False

        if "expires_at" not in tokens:
            # No expiry info, assume invalid
            return False

        try:
            expiry_time = datetime.fromisoformat(tokens["expires_at"])
            # Add 5-minute buffer to refresh before actual expiry
            now = datetime.now()
            is_valid = now < (expiry_time - timedelta(minutes=5))

            if is_valid:
                logger.debug("OAuth2TokenManager", "is_token_valid", f"{provider} token is valid")
            else:
                logger.debug(
                    "OAuth2TokenManager", "is_token_valid", f"{provider} token expired at {tokens['expires_at']}"
                )

            return is_valid
        except Exception as e:
            logger.error("OAuth2TokenManager", "is_token_valid", f"Error checking expiry: {e}")
            return False

    def get_access_token(self, provider: str) -> Optional[str]:
        """
        Get access token for provider.

        If token is expired, attempts to refresh it automatically.

        Args:
            provider: Provider name

        Returns:
            Valid access token or None
        """
        # Check if current token is valid
        if self.is_token_valid(provider):
            tokens = self.load_tokens(provider)
            return tokens.get("access_token") if tokens else None

        # Token expired or missing, try to refresh
        logger.info("OAuth2TokenManager", "get_access_token", f"{provider} token expired, attempting refresh")

        if self.refresh_token(provider):
            tokens = self.load_tokens(provider)
            return tokens.get("access_token") if tokens else None

        logger.warning(
            "OAuth2TokenManager", "get_access_token", f"Failed to refresh {provider} token, re-authentication needed"
        )
        return None

    def refresh_token(self, provider: str) -> bool:
        """
        Refresh access token using refresh token.

        Args:
            provider: Provider name

        Returns:
            True if refresh successful, False otherwise
        """
        try:
            tokens = self.load_tokens(provider)
            if not tokens or "refresh_token" not in tokens:
                logger.warning("OAuth2TokenManager", "refresh_token", f"No refresh token found for {provider}")
                return False

            refresh_token = tokens["refresh_token"]

            # Use OAuth2Manager to refresh
            oauth_manager = OAuth2Manager(provider)
            new_tokens = oauth_manager.refresh_access_token(refresh_token)

            # Save new tokens
            self.save_tokens(provider, new_tokens)

            logger.info("OAuth2TokenManager", "refresh_token", f"Successfully refreshed {provider} token")
            return True

        except Exception as e:
            logger.error("OAuth2TokenManager", "refresh_token", f"Error refreshing token: {e}")
            return False

    def delete_tokens(self, provider: str) -> bool:
        """
        Delete tokens for a provider.

        Args:
            provider: Provider name

        Returns:
            True if deleted successfully, False otherwise
        """
        with self._lock:
            try:
                all_tokens = self._load_tokens_file()

                if provider in all_tokens:
                    del all_tokens[provider]
                    self._save_tokens_file(all_tokens)
                    logger.info("OAuth2TokenManager", "delete_tokens", f"Deleted tokens for {provider}")
                    return True
                else:
                    logger.debug("OAuth2TokenManager", "delete_tokens", f"No tokens to delete for {provider}")
                    return False

            except Exception as e:
                logger.error("OAuth2TokenManager", "delete_tokens", f"Error deleting tokens: {e}")
                return False

    def get_all_providers(self) -> list:
        """
        Get list of providers with stored tokens.

        Returns:
            List of provider names
        """
        all_tokens = self._load_tokens_file()
        return list(all_tokens.keys())

    def get_token_info(self, provider: str) -> Optional[Dict]:
        """
        Get token metadata (without sensitive data).

        Args:
            provider: Provider name

        Returns:
            Dictionary with token info or None
        """
        tokens = self.load_tokens(provider)
        if not tokens:
            return None

        info = {
            "provider": provider,
            "has_access_token": "access_token" in tokens and bool(tokens["access_token"]),
            "has_refresh_token": "refresh_token" in tokens and bool(tokens["refresh_token"]),
            "expires_at": tokens.get("expires_at"),
            "saved_at": tokens.get("saved_at"),
            "scope": tokens.get("scope"),
            "token_type": tokens.get("token_type", "Bearer"),
            "is_valid": self.is_token_valid(provider),
        }

        return info


# Testing interface
if __name__ == "__main__":
    print("=== OAuth2 Token Manager Test ===\n")

    # Create token manager
    manager = OAuth2TokenManager()

    # Test 1: Save mock tokens
    print("1. Testing token storage...")
    mock_tokens = {
        "access_token": "test_access_token_12345",
        "refresh_token": "test_refresh_token_67890",
        "expires_in": 3600,  # 1 hour
        "token_type": "Bearer",
        "scope": "Calendars.Read User.Read",
    }

    if manager.save_tokens("microsoft", mock_tokens):
        print("   [OK] Tokens saved successfully\n")
    else:
        print("   [FAIL] Failed to save tokens\n")

    # Test 2: Load tokens
    print("2. Testing token retrieval...")
    loaded_tokens = manager.load_tokens("microsoft")
    if loaded_tokens:
        print(f"   [OK] Tokens loaded successfully")
        print(f"   Access token (first 20 chars): {loaded_tokens['access_token'][:20]}...")
        print(f"   Has refresh token: {bool(loaded_tokens.get('refresh_token'))}")
        print(f"   Expires at: {loaded_tokens.get('expires_at')}\n")
    else:
        print("   [FAIL] Failed to load tokens\n")

    # Test 3: Check validity
    print("3. Testing token validity...")
    is_valid = manager.is_token_valid("microsoft")
    print(f"   Token valid: {is_valid}\n")

    # Test 4: Get access token
    print("4. Testing access token retrieval...")
    access_token = manager.get_access_token("microsoft")
    if access_token:
        print(f"   [OK] Got access token: {access_token[:20]}...\n")
    else:
        print("   [FAIL] Failed to get access token\n")

    # Test 5: Get token info
    print("5. Testing token info...")
    info = manager.get_token_info("microsoft")
    if info:
        print(f"   [OK] Token info:")
        for key, value in info.items():
            print(f"     {key}: {value}")
        print()
    else:
        print("   [FAIL] No token info\n")

    # Test 6: List providers
    print("6. Testing provider list...")
    providers = manager.get_all_providers()
    print(f"   Providers with tokens: {providers}\n")

    # Test 7: Delete tokens
    print("7. Testing token deletion...")
    if manager.delete_tokens("microsoft"):
        print("   [OK] Tokens deleted successfully\n")
    else:
        print("   [FAIL] Failed to delete tokens\n")

    print("=== Test Complete ===")
