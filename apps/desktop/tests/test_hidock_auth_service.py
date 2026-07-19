"""
Regression tests for HiDock account credential persistence.

These cover a bug where ``HiDockAuthService`` called ``config_and_logger.save_config()``
with no arguments. ``save_config`` requires the settings dict, so every call raised
``TypeError``; because each call site swallows exceptions, login tokens and user info
were never written to disk and logout never cleared them.

``save_config`` merges the supplied settings into the existing on-disk config, so the
fake below reproduces that merge semantics: a logout that only deletes keys from the
in-memory dict would leave the credentials on disk.
"""

from unittest.mock import Mock, patch

import pytest

from hidock_auth_service import HiDockAuthService


class _FakeConfigFile:
    """Stand-in for the on-disk config, mirroring save_config's merge semantics."""

    def __init__(self, initial=None):
        self.data = dict(initial or {})

    def save(self, settings_to_save):
        self.data.update(settings_to_save)


@pytest.fixture
def service():
    """An auth service with encryption and config loading stubbed out."""
    with (
        patch.object(HiDockAuthService, "_get_or_create_encryption_key", return_value=None),
        patch("hidock_auth_service.load_config", return_value={}),
    ):
        auth = HiDockAuthService(config_manager={})
    auth.session = Mock()
    return auth


class TestCredentialPersistence:
    """Credentials must actually reach the config file."""

    def test_save_token_writes_credentials_to_config_file(self, service):
        config_file = _FakeConfigFile({"autoconnect": True})

        with patch("hidock_auth_service.save_config", side_effect=config_file.save) as mock_save:
            service._save_token("secret-token", "alice")

        mock_save.assert_called_once()
        assert config_file.data["hidock_access_token_encrypted"] == "secret-token"
        assert config_file.data["hidock_last_login_username"] == "alice"
        assert config_file.data["hidock_last_login_time"]
        # Unrelated settings must survive the save.
        assert config_file.data["autoconnect"] is True
        # And the in-memory view stays in sync for get_stored_token().
        assert service.get_stored_token() == "secret-token"

    def test_save_user_info_writes_profile_to_config_file(self, service):
        config_file = _FakeConfigFile()

        with patch("hidock_auth_service.save_config", side_effect=config_file.save):
            service._save_user_info(
                {
                    "user_id": "u-1",
                    "email": "alice@example.com",
                    "username": "alice",
                    "refresh_token": "refresh-me",
                    "expires_in": 3600,
                }
            )

        assert config_file.data["hidock_user_id"] == "u-1"
        assert config_file.data["hidock_user_email"] == "alice@example.com"
        assert config_file.data["hidock_username"] == "alice"
        assert config_file.data["hidock_refresh_token_encrypted"] == "refresh-me"
        assert config_file.data["hidock_token_expiry"]
        assert service.config["hidock_user_id"] == "u-1"

    def test_save_user_info_omits_fields_that_were_not_supplied(self, service):
        config_file = _FakeConfigFile()

        with patch("hidock_auth_service.save_config", side_effect=config_file.save):
            service._save_user_info({"username": "alice"})

        assert config_file.data == {"hidock_username": "alice"}

    def test_logout_clears_stored_credentials_on_disk(self, service):
        stored = {
            "hidock_access_token_encrypted": "secret-token",
            "hidock_refresh_token_encrypted": "refresh-me",
            "hidock_user_id": "u-1",
            "hidock_user_email": "alice@example.com",
            "hidock_username": "alice",
            "hidock_token_expiry": "2030-01-01T00:00:00",
            "hidock_last_login_time": "2030-01-01T00:00:00",
            "autoconnect": True,
        }
        service.config = dict(stored)
        config_file = _FakeConfigFile(stored)

        with patch("hidock_auth_service.save_config", side_effect=config_file.save):
            service.logout()

        credential_keys = [key for key in stored if key.startswith("hidock_")]
        for key in credential_keys:
            assert config_file.data[key] == "", f"{key} was left on disk after logout"
            assert key not in service.config, f"{key} was left in memory after logout"

        # Non-credential settings are untouched.
        assert config_file.data["autoconnect"] is True
        assert service.is_logged_in() is False
