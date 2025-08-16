# Test Data Isolation System

This document explains the comprehensive test data isolation system implemented to prevent tests from contaminating production data.

## Overview

The test isolation system ensures that ALL test operations are completely isolated from production configuration files, cache directories, databases, and user data. This prevents the scenarios where tests might corrupt or modify actual application settings.

## What Gets Isolated

### 1. Configuration Files
- `hidock_config.json` - Main application configuration
- `hidock_config.json` - Application configuration
- All config files are redirected to temporary test directories

### 2. Cache and Database Files
- `~/.hidock/cache/` - Application cache directory
- `file_metadata.db` - File metadata database
- `storage_optimization.db` - Storage optimization database
- All cache and database operations use isolated temporary directories

### 3. Home Directory Operations
- `Path.home()` calls return test directories
- `os.path.expanduser("~")` returns test directories
- Prevents any accidental writes to real user home directory

### 4. Default Download Directories
- Default download paths use test directories
- Settings window operations are isolated
- No downloads can accidentally go to production locations

## How It Works

The isolation system is implemented through the `setup_test_environment` fixture in `conftest.py` which:

1. **Creates Isolated Directories**:
   ```
   /tmp/pytest-*/hidock_test_isolation/
   ├── config/     # Configuration files
   ├── cache/      # Cache and database files
   ├── downloads/  # Download directories
   └── home/       # Fake home directory
   ```

2. **Patches System Functions**:
   - Redirects `Path.home()` to test home directory
   - Redirects `os.path.expanduser()` to test home directory
   - Overrides config file paths in `config_and_logger` module
   - Forces cache directories in file operations and storage management

3. **Validates Isolation**:
   - Checks that paths don't contain real home directory
   - Issues warnings if isolation might be compromised
   - Provides environment variables with test directory paths

## Using the Isolation System

### Automatic Protection
The isolation system is **automatically active** for all tests through the `autouse=True` fixture. No special setup required.

### Accessing Test Directories
Use the `isolated_dirs` fixture to access test directories:

```python
def test_something(isolated_dirs):
    config_dir = isolated_dirs['config']
    cache_dir = isolated_dirs['cache']
    downloads_dir = isolated_dirs['downloads']
    home_dir = isolated_dirs['home']
```

### Extra Contamination Protection
For tests that need extra protection, use the contamination check fixture:

```python
@pytest.mark.contamination_check
def test_settings_modification(verify_no_production_contamination):
    # This test will fail if ANY production files are created/modified
    config_and_logger.save_config({"test": "value"})
```

## Environment Variables

The system sets these environment variables for debugging:

- `TESTING=1` - Indicates test mode
- `LOG_LEVEL=DEBUG` - Sets debug logging
- `HIDOCK_TEST_CONFIG_DIR` - Path to test config directory
- `HIDOCK_TEST_CACHE_DIR` - Path to test cache directory
- `HIDOCK_TEST_DOWNLOADS_DIR` - Path to test downloads directory
- `HIDOCK_TEST_HOME_DIR` - Path to fake home directory

## Verification

### Run Isolation Tests
```bash
pytest tests/test_data_isolation.py -v
```

These tests verify:
- Configuration files are isolated
- Cache directories are isolated
- Home directory patching works
- Database files are isolated
- No production files are created

### Check for Contamination
If you suspect contamination, run:
```bash
pytest tests/test_data_isolation.py::TestDataIsolation::test_no_production_file_creation -v
```

## Warning Signs

Watch for these indicators of isolation failure:

1. **Config Path Warnings**: If you see warnings about config paths containing real home directory
2. **Real Files Created**: If production files appear in your actual home directory after tests
3. **Settings Corruption**: If your actual application settings change after running tests

## Troubleshooting

### Tests Creating Real Files
If tests are creating files in production locations:

1. Check that `setup_test_environment` fixture is running (should be automatic)
2. Verify the module is properly importing patched functions
3. Add explicit contamination checks to problematic tests

### Path Resolution Issues
If paths aren't being properly isolated:

1. Check environment variables are set correctly
2. Verify imports happen after patching in `conftest.py`
3. Add debugging to see actual paths being used

### Settings Window Issues
If settings window tests affect production settings:

1. Ensure settings window uses `config_and_logger.load_config()`
2. Don't manually construct config paths
3. Use the isolated settings window initialization

## Best Practices

### For Test Writers
1. **Never hardcode paths** - Use `isolated_dirs` fixture or config functions
2. **Don't bypass isolation** - Don't manually construct paths to home directory
3. **Use contamination checks** - Add `verify_no_production_contamination` for risky tests
4. **Test cleanup** - Ensure tests clean up temporary resources

### For Module Writers
1. **Use config functions** - Always use `config_and_logger.load_config()` and `save_config()`
2. **Parameterize cache dirs** - Accept cache directory parameters in constructors
3. **Avoid hardcoded paths** - Don't hardcode paths to home directory or config files
4. **Respect TESTING env var** - Check `os.getenv("TESTING")` for test-specific behavior

## Integration with CI

The isolation system works automatically in CI environments:
- GitHub Actions gets full isolation
- No special CI configuration needed
- All operations are in CI runner's temp directories
- No risk of contaminating CI runner's file system

## Performance Impact

The isolation system has minimal performance impact:
- Only adds path redirection overhead
- Temporary directories are cleaned up automatically
- No network or I/O blocking
- Approximately 1-2ms overhead per test
