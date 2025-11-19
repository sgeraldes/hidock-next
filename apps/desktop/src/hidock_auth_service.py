# hidock_auth_service.py
"""
HiDock Authentication Service.

Handles user authentication, token management, and session persistence for the
HiDock/HiNotes backend API.

Features:
- Username/password login
- Access token management
- Encrypted token storage
- Automatic token refresh (if supported)
- Session validation
- Logout functionality

Architecture:
    Desktop App → HiDockAuthService → HiNotes API → User Account

The access token is used for all HiNotes API calls (calendar, etc.).
"""

import os
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

import requests

from config_and_logger import load_config, logger, save_config

try:
    from cryptography.fernet import Fernet

    ENCRYPTION_AVAILABLE = True
except ImportError:
    ENCRYPTION_AVAILABLE = False
    Fernet = None
    logger.warning("HiDockAuth", "import", "Cryptography not available - tokens will be stored in plain text")


# HiDock API Configuration
HIDOCK_API_BASE = "https://hinotes.hidock.com"
HIDOCK_API_VERSION = "v1"


class AuthenticationError(Exception):
    """Raised when authentication fails."""

    pass


class TokenExpiredError(Exception):
    """Raised when access token has expired."""

    pass


class HiDockAuthService:
    """
    Service for authenticating with HiDock/HiNotes backend.

    Manages user login, token storage, and session lifecycle.
    """

    # Login endpoint (will be confirmed from HAR analysis)
    # Common patterns: /v1/auth/login, /v1/user/login, /v1/account/login
    LOGIN_ENDPOINT = f"/{HIDOCK_API_VERSION}/auth/login"  # TODO: Confirm from HAR
    REFRESH_ENDPOINT = f"/{HIDOCK_API_VERSION}/auth/refresh"  # TODO: Confirm from HAR
    LOGOUT_ENDPOINT = f"/{HIDOCK_API_VERSION}/auth/logout"  # TODO: Confirm from HAR
    VALIDATE_ENDPOINT = f"/{HIDOCK_API_VERSION}/auth/validate"  # TODO: Confirm from HAR

    def __init__(self, config_manager=None):
        """
        Initialize authentication service.

        Args:
            config_manager: Optional config manager for custom config handling
        """
        self.config = config_manager or load_config()
        self.session = requests.Session()
        self._encryption_key = self._get_or_create_encryption_key()

    def _get_or_create_encryption_key(self) -> Optional[bytes]:
        """Get or create encryption key for token storage."""
        if not ENCRYPTION_AVAILABLE:
            return None

        key_file = os.path.join(os.path.dirname(__file__), ".hidock_auth_key.dat")

        try:
            if os.path.exists(key_file):
                with open(key_file, "rb") as f:
                    return f.read()
            else:
                # Generate new key
                key = Fernet.generate_key()
                with open(key_file, "wb") as f:
                    f.write(key)
                logger.info("HiDockAuth", "encryption_key", "Generated new encryption key")
                return key
        except Exception as e:
            logger.error("HiDockAuth", "encryption_key", f"Error with encryption key: {e}")
            return None

    def _encrypt_token(self, token: str) -> str:
        """Encrypt access token for storage."""
        if not ENCRYPTION_AVAILABLE or not self._encryption_key:
            return token  # Store in plain text if encryption unavailable

        try:
            cipher = Fernet(self._encryption_key)
            encrypted = cipher.encrypt(token.encode())
            return encrypted.decode()
        except Exception as e:
            logger.error("HiDockAuth", "encrypt", f"Encryption failed: {e}")
            return token

    def _decrypt_token(self, encrypted_token: str) -> str:
        """Decrypt access token from storage."""
        if not ENCRYPTION_AVAILABLE or not self._encryption_key:
            return encrypted_token  # Assume plain text

        try:
            cipher = Fernet(self._encryption_key)
            decrypted = cipher.decrypt(encrypted_token.encode())
            return decrypted.decode()
        except Exception as e:
            logger.error("HiDockAuth", "decrypt", f"Decryption failed: {e}")
            # Might be plain text from old version
            return encrypted_token

    def login(
        self, username: str, password: str, remember_me: bool = True
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Authenticate user with username and password.

        Args:
            username: User's email or username
            password: User's password
            remember_me: If True, save token for future sessions

        Returns:
            Tuple of (success, access_token, error_message)

        Raises:
            AuthenticationError: If login fails
        """
        url = f"{HIDOCK_API_BASE}{self.LOGIN_ENDPOINT}"

        # Build login payload
        # TODO: Adjust format based on actual HAR analysis
        # Common formats:
        # Format 1: {"username": "...", "password": "..."}
        # Format 2: {"email": "...", "password": "..."}
        # Format 3: {"user": "...", "pass": "..."}
        # Format 4: {"account": "...", "password": "..."}

        payload = {"username": username, "password": password, "rememberMe": remember_me}  # or "email", "account", etc.

        try:
            logger.info("HiDockAuth", "login", f"Attempting login for user: {username}")

            response = self.session.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                },
                timeout=30,
            )

            # Parse response
            # TODO: Adjust based on actual API response format

            if response.status_code == 200:
                data = response.json()

                # Common response formats:
                # Format 1: {"code": 200, "msg": "success", "data": {"accessToken": "..."}}
                # Format 2: {"success": true, "token": "...", "user": {...}}
                # Format 3: {"accessToken": "...", "refreshToken": "...", "expiresIn": 3600}

                # Try to extract token (flexible parsing)
                access_token = None

                # Try common patterns
                if isinstance(data, dict):
                    # Pattern 1: data.accessToken
                    if "accessToken" in data:
                        access_token = data["accessToken"]
                    # Pattern 2: data.data.accessToken
                    elif "data" in data and isinstance(data["data"], dict):
                        if "accessToken" in data["data"]:
                            access_token = data["data"]["accessToken"]
                        elif "token" in data["data"]:
                            access_token = data["data"]["token"]
                    # Pattern 3: data.token
                    elif "token" in data:
                        access_token = data["token"]

                if access_token:
                    logger.info("HiDockAuth", "login", f"Login successful for {username}")

                    # Store token if remember_me
                    if remember_me:
                        self._save_token(access_token, username)

                    # Extract additional info
                    user_info = self._extract_user_info(data)
                    if user_info:
                        self._save_user_info(user_info)

                    return True, access_token, None
                else:
                    logger.error("HiDockAuth", "login", f"Token not found in response: {data}")
                    return False, None, "Access token not found in response"

            elif response.status_code == 401:
                logger.warning("HiDockAuth", "login", "Invalid credentials")
                return False, None, "Invalid username or password"

            elif response.status_code == 403:
                logger.warning("HiDockAuth", "login", "Account locked or forbidden")
                return False, None, "Account access forbidden. Please contact support."

            else:
                error_msg = f"Login failed with status {response.status_code}"
                logger.error("HiDockAuth", "login", error_msg)
                return False, None, error_msg

        except requests.exceptions.Timeout:
            error_msg = "Login request timed out. Please check your internet connection."
            logger.error("HiDockAuth", "login", error_msg)
            return False, None, error_msg

        except requests.exceptions.ConnectionError:
            error_msg = "Could not connect to HiDock servers. Please check your internet connection."
            logger.error("HiDockAuth", "login", error_msg)
            return False, None, error_msg

        except Exception as e:
            error_msg = f"Login error: {str(e)}"
            logger.error("HiDockAuth", "login", error_msg)
            return False, None, error_msg

    def _extract_user_info(self, response_data: Dict) -> Optional[Dict]:
        """Extract user information from login response."""
        try:
            # Common patterns for user info in response
            if "data" in response_data and isinstance(response_data["data"], dict):
                data = response_data["data"]
                return {
                    "user_id": data.get("userId") or data.get("id") or data.get("uid"),
                    "email": data.get("email"),
                    "username": data.get("username") or data.get("name"),
                    "expires_in": data.get("expiresIn"),
                    "refresh_token": data.get("refreshToken"),
                }
            return None
        except Exception as e:
            logger.warning("HiDockAuth", "extract_user_info", f"Could not extract user info: {e}")
            return None

    def _save_user_info(self, user_info: Dict):
        """Save user information to config."""
        try:
            if user_info.get("user_id"):
                self.config["hidock_user_id"] = user_info["user_id"]
            if user_info.get("email"):
                self.config["hidock_user_email"] = user_info["email"]
            if user_info.get("username"):
                self.config["hidock_username"] = user_info["username"]
            if user_info.get("refresh_token"):
                encrypted_refresh = self._encrypt_token(user_info["refresh_token"])
                self.config["hidock_refresh_token_encrypted"] = encrypted_refresh
            if user_info.get("expires_in"):
                # Calculate expiry timestamp
                expiry_time = datetime.now() + timedelta(seconds=user_info["expires_in"])
                self.config["hidock_token_expiry"] = expiry_time.isoformat()

            save_config()
            logger.info("HiDockAuth", "save_user_info", "User info saved")
        except Exception as e:
            logger.error("HiDockAuth", "save_user_info", f"Error saving user info: {e}")

    def _save_token(self, access_token: str, username: str):
        """Save access token to config (encrypted)."""
        try:
            encrypted_token = self._encrypt_token(access_token)
            self.config["hidock_access_token_encrypted"] = encrypted_token
            self.config["hidock_last_login_username"] = username
            self.config["hidock_last_login_time"] = datetime.now().isoformat()
            save_config()
            logger.info("HiDockAuth", "save_token", "Token saved securely")
        except Exception as e:
            logger.error("HiDockAuth", "save_token", f"Error saving token: {e}")

    def get_stored_token(self) -> Optional[str]:
        """
        Get stored access token from config.

        Returns:
            Decrypted access token if available, None otherwise
        """
        try:
            encrypted_token = self.config.get("hidock_access_token_encrypted", "")
            if encrypted_token:
                return self._decrypt_token(encrypted_token)

            # Fallback to plain text (for backwards compatibility)
            return self.config.get("hidock_access_token", "")
        except Exception as e:
            logger.error("HiDockAuth", "get_stored_token", f"Error retrieving token: {e}")
            return None

    def is_logged_in(self) -> bool:
        """Check if user has a valid stored token."""
        token = self.get_stored_token()
        if not token:
            return False

        # Check token expiry if available
        expiry_str = self.config.get("hidock_token_expiry", "")
        if expiry_str:
            try:
                expiry_time = datetime.fromisoformat(expiry_str)
                if datetime.now() >= expiry_time:
                    logger.info("HiDockAuth", "is_logged_in", "Token expired")
                    return False
            except:
                pass

        return True

    def validate_token(self, token: Optional[str] = None) -> bool:
        """
        Validate access token with server.

        Args:
            token: Token to validate. If None, uses stored token.

        Returns:
            True if token is valid, False otherwise
        """
        if token is None:
            token = self.get_stored_token()

        if not token:
            return False

        # Try a simple API call to validate token
        # Using calendar status endpoint as validation
        url = f"{HIDOCK_API_BASE}/{HIDOCK_API_VERSION}/calendar/status"

        try:
            response = self.session.post(
                url, json={"calendarWay": "microsoft"}, headers={"AccessToken": token}, timeout=10
            )

            if response.status_code == 200:
                return True
            elif response.status_code == 401:
                logger.info("HiDockAuth", "validate_token", "Token invalid or expired")
                return False
            else:
                logger.warning("HiDockAuth", "validate_token", f"Unexpected status: {response.status_code}")
                return False

        except Exception as e:
            logger.error("HiDockAuth", "validate_token", f"Validation error: {e}")
            return False

    def logout(self):
        """Logout user and clear stored credentials."""
        try:
            token = self.get_stored_token()

            # Try to logout on server (if endpoint exists)
            if token:
                try:
                    url = f"{HIDOCK_API_BASE}{self.LOGOUT_ENDPOINT}"
                    self.session.post(url, headers={"AccessToken": token}, timeout=5)
                except:
                    pass  # Logout endpoint might not exist

            # Clear stored credentials
            keys_to_remove = [
                "hidock_access_token",
                "hidock_access_token_encrypted",
                "hidock_refresh_token_encrypted",
                "hidock_user_id",
                "hidock_user_email",
                "hidock_username",
                "hidock_token_expiry",
                "hidock_last_login_time",
            ]

            for key in keys_to_remove:
                if key in self.config:
                    del self.config[key]

            save_config()
            logger.info("HiDockAuth", "logout", "User logged out successfully")

        except Exception as e:
            logger.error("HiDockAuth", "logout", f"Logout error: {e}")

    def get_user_info(self) -> Optional[Dict]:
        """Get stored user information."""
        if not self.is_logged_in():
            return None

        return {
            "username": self.config.get("hidock_username", ""),
            "email": self.config.get("hidock_user_email", ""),
            "user_id": self.config.get("hidock_user_id", ""),
            "last_login": self.config.get("hidock_last_login_time", ""),
        }

    def refresh_token(self) -> Tuple[bool, Optional[str]]:
        """
        Refresh access token using refresh token.

        Returns:
            Tuple of (success, new_access_token)
        """
        refresh_token_encrypted = self.config.get("hidock_refresh_token_encrypted", "")
        if not refresh_token_encrypted:
            logger.warning("HiDockAuth", "refresh_token", "No refresh token available")
            return False, None

        refresh_token = self._decrypt_token(refresh_token_encrypted)

        url = f"{HIDOCK_API_BASE}{self.REFRESH_ENDPOINT}"

        try:
            response = self.session.post(url, json={"refreshToken": refresh_token}, timeout=10)

            if response.status_code == 200:
                data = response.json()

                # Extract new access token
                new_token = None
                if "accessToken" in data:
                    new_token = data["accessToken"]
                elif "data" in data and "accessToken" in data["data"]:
                    new_token = data["data"]["accessToken"]

                if new_token:
                    # Save new token
                    username = self.config.get("hidock_last_login_username", "")
                    self._save_token(new_token, username)
                    logger.info("HiDockAuth", "refresh_token", "Token refreshed successfully")
                    return True, new_token

            logger.error("HiDockAuth", "refresh_token", f"Refresh failed: {response.status_code}")
            return False, None

        except Exception as e:
            logger.error("HiDockAuth", "refresh_token", f"Refresh error: {e}")
            return False, None


# Convenience functions for quick access
def login_user(username: str, password: str, remember_me: bool = True) -> Tuple[bool, Optional[str], Optional[str]]:
    """Quick login function."""
    service = HiDockAuthService()
    return service.login(username, password, remember_me)


def get_access_token() -> Optional[str]:
    """Quick function to get stored access token."""
    service = HiDockAuthService()
    return service.get_stored_token()


def is_user_logged_in() -> bool:
    """Quick function to check login status."""
    service = HiDockAuthService()
    return service.is_logged_in()


def logout_user():
    """Quick logout function."""
    service = HiDockAuthService()
    service.logout()


# CLI testing interface
if __name__ == "__main__":
    import getpass

    print("=== HiDock Authentication Service - Test CLI ===\n")

    service = HiDockAuthService()

    # Check if already logged in
    if service.is_logged_in():
        user_info = service.get_user_info()
        print(f"Already logged in as: {user_info.get('email') or user_info.get('username')}")
        print(f"Last login: {user_info.get('last_login')}\n")

        choice = input("Do you want to (1) Stay logged in, (2) Logout, (3) Test token? [1]: ").strip() or "1"

        if choice == "2":
            service.logout()
            print("Logged out successfully.")
        elif choice == "3":
            token = service.get_stored_token()
            print(f"\nStored token: {token[:20]}...{token[-20:]}")
            print("Validating token...")
            if service.validate_token():
                print("✓ Token is valid!")
            else:
                print("✗ Token is invalid or expired")
    else:
        print("Not logged in.\n")

        username = input("Username/Email: ").strip()
        password = getpass.getpass("Password: ")
        remember = input("Remember me? [Y/n]: ").strip().lower() != "n"

        print("\nAttempting login...")
        success, token, error = service.login(username, password, remember)

        if success:
            print("\n✓ Login successful!")
            print(f"Access token: {token[:20]}...{token[-20:]}")

            user_info = service.get_user_info()
            if user_info:
                print(f"User: {user_info.get('email') or user_info.get('username')}")
        else:
            print(f"\n✗ Login failed: {error}")
