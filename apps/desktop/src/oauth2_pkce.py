# oauth2_pkce.py
"""
OAuth2 PKCE (Proof Key for Code Exchange) Implementation.

PKCE is required for public clients (desktop/mobile apps) to securely
perform OAuth2 authorization code flow without a client secret.

Defined in: RFC 7636 - https://tools.ietf.org/html/rfc7636

Key Concepts:
- code_verifier: Random string (43-128 chars)
- code_challenge: SHA256 hash of code_verifier, base64url encoded
- code_challenge_method: Always "S256" (SHA256)

Security:
- Prevents authorization code interception attacks
- Required by OAuth 2.1 specification
- Supported by Microsoft, Google, and most modern OAuth providers
"""

import base64
import hashlib
import secrets


def generate_code_verifier(length: int = 64) -> str:
    """
    Generate a cryptographically secure PKCE code verifier.

    Args:
        length: Length of verifier (43-128 characters). Default 64.

    Returns:
        Random base64url-encoded string

    Spec:
        code_verifier = high-entropy cryptographic random STRING using the
        unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
        with a minimum length of 43 characters and a maximum length of 128 characters.
    """
    if not 43 <= length <= 128:
        raise ValueError("Code verifier length must be between 43 and 128 characters")

    # Generate random bytes
    # We need enough bytes to get desired length after base64url encoding
    # Base64 encoding increases size by 4/3, so we need (length * 3/4) bytes
    num_bytes = (length * 3) // 4

    random_bytes = secrets.token_bytes(num_bytes)

    # Base64url encode (URL-safe, no padding)
    verifier = base64.urlsafe_b64encode(random_bytes).decode("utf-8").rstrip("=")

    # Ensure exactly the requested length
    return verifier[:length]


def generate_code_challenge(code_verifier: str) -> str:
    """
    Generate PKCE code challenge from code verifier.

    Args:
        code_verifier: The code verifier string

    Returns:
        Base64url-encoded SHA256 hash of the verifier

    Spec:
        code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
    """
    # SHA256 hash of the verifier
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()

    # Base64url encode (URL-safe, no padding)
    challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")

    return challenge


def generate_pkce_pair() -> tuple[str, str]:
    """
    Generate a PKCE code verifier and challenge pair.

    Returns:
        Tuple of (code_verifier, code_challenge)

    Example:
        verifier, challenge = generate_pkce_pair()
        # Use verifier in token exchange
        # Use challenge in authorization request
    """
    verifier = generate_code_verifier()
    challenge = generate_code_challenge(verifier)
    return verifier, challenge


def verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    """
    Verify that a code verifier matches a code challenge.

    This is typically done by the OAuth provider, but can be useful for testing.

    Args:
        code_verifier: The original code verifier
        code_challenge: The code challenge to verify against

    Returns:
        True if verifier produces the given challenge, False otherwise
    """
    computed_challenge = generate_code_challenge(code_verifier)
    return computed_challenge == code_challenge


# Example usage and testing
if __name__ == "__main__":
    print("=== OAuth2 PKCE Generator ===\n")

    # Generate PKCE pair
    verifier, challenge = generate_pkce_pair()

    print(f"Code Verifier ({len(verifier)} chars):")
    print(f"  {verifier}\n")

    print(f"Code Challenge ({len(challenge)} chars):")
    print(f"  {challenge}\n")

    print("Code Challenge Method: S256\n")

    # Verify
    is_valid = verify_pkce(verifier, challenge)
    print(f"Verification: {'✓ Valid' if is_valid else '✗ Invalid'}\n")

    # Show how to use in OAuth request
    print("=== Usage in OAuth2 Flow ===\n")

    print("1. Authorization Request (send to OAuth provider):")
    print("   https://login.microsoftonline.com/.../authorize?")
    print("     client_id=YOUR_CLIENT_ID")
    print("     &redirect_uri=http://localhost:8080/callback")
    print("     &response_type=code")
    print(f"     &code_challenge={challenge}")
    print("     &code_challenge_method=S256\n")

    print("2. Token Exchange (after receiving authorization code):")
    print("   POST https://login.microsoftonline.com/.../token")
    print("   Body:")
    print("     grant_type=authorization_code")
    print("     &code=AUTHORIZATION_CODE_FROM_CALLBACK")
    print("     &redirect_uri=http://localhost:8080/callback")
    print("     &client_id=YOUR_CLIENT_ID")
    print(f"     &code_verifier={verifier}\n")

    print("3. Provider verifies:")
    print(f"   SHA256({verifier}) == {challenge}")
    print("   If match: Returns access token ✓")
    print("   If mismatch: Returns error ✗\n")

    # Test with multiple generations
    print("=== Testing Multiple Generations ===\n")
    for i in range(3):
        v, c = generate_pkce_pair()
        print(f"Pair {i+1}:")
        print(f"  Verifier: {v[:30]}...{v[-10:]}")
        print(f"  Challenge: {c}")
        print(f"  Valid: {verify_pkce(v, c)}")
        print()
