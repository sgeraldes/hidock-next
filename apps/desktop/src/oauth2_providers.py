# oauth2_providers.py
"""
OAuth2 Provider Configurations.

Contains configuration for Microsoft and Google OAuth2 providers.
These are used by the OAuth2Manager to perform authentication.

Security Note:
- Microsoft: No client secret needed (public client with PKCE)
- Google: Requires client secret (add when you have it)
- Never commit client secrets to version control
"""

# Microsoft Azure AD Configuration
MICROSOFT_CONFIG = {
    'provider': 'microsoft',
    'name': 'Microsoft Outlook',

    # Your Azure AD App Registration
    'client_id': '3ff731d3-28ff-47b9-947f-b3ecdb1e27b4',

    # OAuth2 Endpoints (Microsoft Identity Platform v2.0)
    # Using 'common' to support both personal and work/school accounts
    'auth_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'token_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/token',

    # Scopes (permissions)
    'scope': 'openid offline_access Calendars.Read User.Read',
    # openid: Basic identity info
    # offline_access: Refresh token
    # Calendars.Read: Read calendar events
    # User.Read: Read user profile

    # API Endpoint
    'graph_endpoint': 'https://graph.microsoft.com/v1.0',

    # OAuth Flow Settings
    'response_type': 'code',
    'response_mode': 'query',
    'use_pkce': True,  # Always use PKCE for security
}

# Google Cloud Configuration
GOOGLE_CONFIG = {
    'provider': 'google',
    'name': 'Google Calendar',

    # Your Google Cloud Project OAuth Client
    'client_id': 'YOUR_GOOGLE_CLIENT_ID_HERE',  # TODO: Add when you register Google app
    'client_secret': 'YOUR_GOOGLE_CLIENT_SECRET_HERE',  # TODO: Google requires client secret

    # OAuth2 Endpoints
    'auth_url': 'https://accounts.google.com/o/oauth2/v2/auth',
    'token_url': 'https://oauth2.googleapis.com/token',
    'revoke_url': 'https://oauth2.googleapis.com/revoke',

    # Scopes (permissions)
    'scope': 'openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
    # openid: Basic identity
    # calendar.readonly: Read calendar events
    # userinfo.email: Get user's email

    # API Endpoint
    'api_endpoint': 'https://www.googleapis.com/calendar/v3',

    # OAuth Flow Settings
    'response_type': 'code',
    'access_type': 'offline',  # Request refresh token
    'prompt': 'consent',  # Always show consent screen (ensures refresh token)
    'use_pkce': True,  # Use PKCE for security
}


def get_provider_config(provider: str) -> dict:
    """
    Get configuration for specified provider.

    Args:
        provider: 'microsoft' or 'google'

    Returns:
        Provider configuration dictionary

    Raises:
        ValueError: If provider is not supported
    """
    if provider == 'microsoft':
        return MICROSOFT_CONFIG
    elif provider == 'google':
        return GOOGLE_CONFIG
    else:
        raise ValueError(f"Unsupported provider: {provider}")


def is_provider_configured(provider: str) -> bool:
    """
    Check if provider is properly configured.

    Args:
        provider: 'microsoft' or 'google'

    Returns:
        True if provider has valid client_id, False otherwise
    """
    try:
        config = get_provider_config(provider)
        client_id = config.get('client_id', '')

        # Check if client_id is set and not placeholder
        if not client_id or 'YOUR_' in client_id or '_HERE' in client_id:
            return False

        return True
    except:
        return False


def get_available_providers() -> list:
    """
    Get list of properly configured providers.

    Returns:
        List of provider names (e.g., ['microsoft', 'google'])
    """
    providers = []

    for provider in ['microsoft', 'google']:
        if is_provider_configured(provider):
            providers.append(provider)

    return providers


# Configuration validation
if __name__ == '__main__':
    print("=== OAuth2 Provider Configuration ===\n")

    # Check Microsoft
    print("Microsoft Configuration:")
    if is_provider_configured('microsoft'):
        config = MICROSOFT_CONFIG
        print(f"  ✓ Configured")
        print(f"  Client ID: {config['client_id'][:20]}...{config['client_id'][-10:]}")
        print(f"  Scopes: {config['scope']}")
        print(f"  Auth URL: {config['auth_url']}")
    else:
        print(f"  ✗ Not configured (missing client_id)")

    print()

    # Check Google
    print("Google Configuration:")
    if is_provider_configured('google'):
        config = GOOGLE_CONFIG
        print(f"  ✓ Configured")
        print(f"  Client ID: {config['client_id'][:20]}...{config['client_id'][-10:]}")
        print(f"  Scopes: {config['scope']}")
    else:
        print(f"  ✗ Not configured (missing client_id)")

    print()

    # Show available providers
    available = get_available_providers()
    print(f"Available Providers: {', '.join(available) if available else 'None'}")
