"""
Regression tests for HiDock account credential persistence.

These cover a bug where ``HiDockAuthService`` called ``config_and_logger.save_config()``
with no arguments. ``save_config`` requires the settings dict, so every call raised
``TypeError``; because each call site swallows exceptions, login tokens and user info
were never written to disk and logout never cleared them.

``save_config`` merges the supplied settings into the existing on-disk config, so the
fake below reproduces that merge semantics: a logout that only deletes keys from the
in-memory dict would leave the credentials on disk.

They also cover the follow-on bug that fixing the above exposed. ``_save_token`` was
gated on ``remember_me`` but ``_save_user_info`` was called unconditionally, and the
refresh token and expiry arrive through *user_info*. Once the writes started working,
declining "remember me" still left a reusable refresh credential on disk.
"""

from unittest.mock import Mock, patch

import pytest

from hidock_auth_service import (
    CREDENTIAL_CONFIG_KEYS,
    PERSISTED_SESSION_KEYS,
    HiDockAuthService,
)


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

    def test_logout_clears_every_persisted_key_on_disk(self, service):
        # Build the fixture from the module's own key list rather than hand-listing it, so
        # a newly added key cannot slip past this test the way hidock_last_login_username
        # did -- it was missing from both the logout list and the original fixture.
        stored = {key: f"stored-{key}" for key in PERSISTED_SESSION_KEYS}
        stored["autoconnect"] = True
        service.config = dict(stored)
        config_file = _FakeConfigFile(stored)

        with patch("hidock_auth_service.save_config", side_effect=config_file.save):
            service.logout()

        for key in PERSISTED_SESSION_KEYS:
            assert config_file.data[key] == "", f"{key} was left on disk after logout"
            assert key not in service.config, f"{key} was left in memory after logout"

        # Non-credential settings are untouched.
        assert config_file.data["autoconnect"] is True
        assert service.is_logged_in() is False


class TestRememberMe:
    """Declining "remember me" must leave nothing reusable on disk."""

    LOGIN_RESPONSE = {
        "data": {
            "accessToken": "access-abc",
            "refreshToken": "refresh-xyz",
            "expiresIn": 3600,
            "userId": "u-1",
            "email": "alice@example.com",
            "username": "alice",
        }
    }

    def _login(self, service, config_file, remember_me):
        response = Mock(status_code=200)
        response.json.return_value = self.LOGIN_RESPONSE
        service.session.post.return_value = response

        with patch("hidock_auth_service.save_config", side_effect=config_file.save):
            return service.login("alice", "hunter2", remember_me=remember_me)

    def test_remember_me_persists_the_full_session(self, service):
        config_file = _FakeConfigFile()

        success, token, error = self._login(service, config_file, remember_me=True)

        assert (success, token, error) == (True, "access-abc", None)
        assert config_file.data["hidock_access_token_encrypted"] == "access-abc"
        assert config_file.data["hidock_refresh_token_encrypted"] == "refresh-xyz"
        assert config_file.data["hidock_token_expiry"]
        assert config_file.data["hidock_last_login_username"] == "alice"
        assert config_file.data["hidock_user_email"] == "alice@example.com"

    def test_declining_remember_me_writes_no_credential_to_disk(self, service):
        """The response carries a refresh token; none of it may reach the config file."""
        config_file = _FakeConfigFile()

        success, token, error = self._login(service, config_file, remember_me=False)

        assert (success, token, error) == (True, "access-abc", None)

        # Nothing credential-bearing on disk, under any key.
        for key in CREDENTIAL_CONFIG_KEYS:
            assert not config_file.data.get(key), f"{key} was persisted despite remember_me=False"
        for value in config_file.data.values():
            assert value not in ("access-abc", "refresh-xyz"), "a token leaked into the config file"

        # ...but the session still works in memory for the rest of this run.
        assert service.get_stored_token() == "access-abc"
        assert service.is_logged_in() is True

    def test_declining_remember_me_clears_a_previously_remembered_session(self, service):
        """Turning "remember me" off must not leave yesterday's credential behind."""
        remembered = {key: f"stored-{key}" for key in PERSISTED_SESSION_KEYS}
        remembered["autoconnect"] = True
        service.config = dict(remembered)
        config_file = _FakeConfigFile(remembered)

        self._login(service, config_file, remember_me=False)

        for key in PERSISTED_SESSION_KEYS:
            assert not config_file.data.get(key), f"{key} survived a remember_me=False login"

        assert config_file.data["autoconnect"] is True
        # The new session is still usable in memory.
        assert service.get_stored_token() == "access-abc"
