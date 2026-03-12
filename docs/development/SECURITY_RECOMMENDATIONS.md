# HiDock Security Recommendations

## Current Security Issues

### 1. Encryption Key Co-location Vulnerability
**Problem**: The encryption key (`.hidock_key.dat`) is stored in the same directory as the encrypted configuration file.

**Risk**: If an attacker gains access to the application directory, they can decrypt all API keys.

**Impact**: Complete compromise of all stored API credentials.

## Recommended Security Improvements

### Option 1: OS Keystore Integration (Recommended)
Use the operating system's secure credential storage:

```python
# Windows: Windows Credential Manager
# macOS: Keychain Services  
# Linux: Secret Service API (GNOME Keyring, KWallet)

import keyring

# Store API key
keyring.set_password("hidock", f"api_key_{provider}", api_key)

# Retrieve API key
api_key = keyring.get_password("hidock", f"api_key_{provider}")
```

**Benefits**:
- OS-level security and user authentication
- No plaintext storage on disk
- User-specific protection
- Integration with system security policies

### Option 2: Machine-bound Key Derivation
Derive encryption keys from machine-specific identifiers:

```python
import hashlib
import platform
from cryptography.fernet import Fernet

def generate_machine_key():
    """Generate encryption key based on machine characteristics."""
    machine_id = platform.node() + platform.machine() + platform.processor()
    # Add more stable machine identifiers
    key_material = hashlib.sha256(machine_id.encode()).digest()
    return base64.urlsafe_b64encode(key_material)
```

**Benefits**:
- Keys don't work on different machines
- No separate key file needed
- Automatic machine binding

### Option 3: User-derived Key with Salt
Use user credentials with proper salt and key derivation:

```python
import getpass
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

def derive_user_key(password: str, salt: bytes) -> bytes:
    """Derive encryption key from user password."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,  # Adjust based on security needs
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))
```

**Benefits**:
- User-specific protection
- Requires user authentication
- No stored key files

### Option 4: Hybrid Approach (Most Secure)
Combine multiple protection layers:

1. **OS Keystore** for primary protection
2. **Machine binding** as fallback
3. **File permissions** for additional security
4. **Encryption key rotation** for long-term security

## Implementation Priority

1. **Immediate**: Implement OS keystore integration (Option 1)
2. **Short-term**: Add machine binding as fallback (Option 2)
3. **Long-term**: Implement key rotation and audit logging

## Security Best Practices

### Configuration File Security
- Store config files with restricted permissions (600)
- Use separate config directory outside application folder
- Implement config file integrity checking

### API Key Management
- Support API key rotation
- Implement key expiration checking
- Add secure key deletion on uninstall

### Error Handling
- Never log decrypted keys or encryption errors with details
- Implement secure key validation
- Provide clear security status to users

### Audit and Monitoring
- Log encryption/decryption events (without sensitive data)
- Monitor for unauthorized access attempts
- Provide security status dashboard

## Migration Strategy

1. **Detect existing installation** with old key storage
2. **Migrate keys** to new secure storage
3. **Clean up** old key files securely
4. **Maintain backward compatibility** during transition period

## Testing Security Improvements

```python
def test_key_security():
    """Test that encryption keys are properly protected."""
    # Test 1: Verify no plaintext keys in config
    # Test 2: Verify key derivation from secure sources
    # Test 3: Verify keys don't work on different machines
    # Test 4: Verify proper cleanup of temporary keys
```

## References

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [Python Keyring Documentation](https://keyring.readthedocs.io/)
- [Cryptography Library Best Practices](https://cryptography.io/en/latest/faq/)
