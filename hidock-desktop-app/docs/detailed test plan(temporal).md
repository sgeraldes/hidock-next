# Detailed Test Plan for HiDock Desktop App

## Current Test Status

- **Total Tests**: 606
- **Passed**: 577
- **Failed**: 25
- **Skipped**: 4
- **Pass Rate**: 95.2%
- **Target Coverage**: 80%

## Test Failure Analysis

### 1. Device Fallback Tests (4 failures)

**Files**: `test_device_fallback_mocked.py`
**Issue**: `force_reset` parameter added to connect() method but tests not updated
**Root Cause**: Tests expect connect() without `force_reset=False` parameter

**Failed Tests**:

- `test_connect_with_device_id`
- `test_connect_auto_retry_disabled`
- `test_connect_invalid_device_id_format`
- `test_connect_no_device_id_uses_defaults`

**Fix**: Update mock assertions to include `force_reset=False` parameter

### 2. Device Reset Test (1 failure)

**File**: `test_device_reset_simple.py`
**Test**: `test_device_reset_with_connected_device`
**Issue**: AssertionError - Device reset functionality test failed
**Root Cause**: Likely missing or changed device reset implementation

### 3. Device Selector Tests (5 failures)

**Files**: `test_device_selector_fix.py`, `test_settings_device_selector_bug.py`
**Issue**: TypeError: unsupported operand type(s) for +: 'Mock' and 'int'
**Root Cause**: Mock object used where integer expected in CTk widget calculations

**Failed Tests**:

- `test_enhanced_device_selector_has_set_enabled_method`
- `test_set_enabled_method_works`
- `test_set_enabled_false_disables_components`
- `test_set_enabled_true_enables_components`
- `test_device_selector_configure_state_should_not_fail`

**Fix**: Properly mock CTk widgets with numeric attributes

### 4. GUI Component Test (1 failure)

**File**: `test_gui_components.py`
**Test**: `test_background_waveform_processing`
**Issue**: Sample rate not preserved, getting "No waveform data extracted"
**Root Cause**: Waveform extraction failing or returning error message

### 5. Settings Window Tests (14 failures)

**Files**: Multiple `test_settings_*.py` files
**Issues**:

- Missing `cryptography` module imports
- Missing attribute errors (tk, Fernet, Path, asyncio)
- Invalid color errors in Tkinter
- KeyError for 'ai_api_provider_var'
- Validation methods returning False instead of True

**Categories**:

- **Encryption-related** (5 failures): Missing cryptography module/imports
- **Tkinter-related** (2 failures): Invalid color handling
- **Validation** (2 failures): Methods returning incorrect boolean
- **Missing imports** (3 failures): Path, asyncio not imported
- **Missing attributes** (2 failures): tk attribute, ai_api_provider_var

## Fix Priority Order

### Phase 1: Import and Module Issues (High Priority)

1. Fix missing imports in `settings_window.py`:
   - Add `from pathlib import Path`
   - Add `import asyncio`
   - Add cryptography imports with try/except fallback
2. Ensure all required modules are properly imported

### Phase 2: Device Tests (High Priority)

1. Update device fallback tests to include `force_reset=False`
2. Fix device selector mock issues with proper CTk mocking
3. Investigate and fix device reset functionality

### Phase 3: Settings Window Core Issues (Medium Priority)

1. Fix validation methods to return correct boolean values
2. Add missing `ai_api_provider_var` to local_vars
3. Fix Tkinter color handling with proper error handling
4. Ensure SettingsDialog has proper tk initialization

### Phase 4: Waveform Processing (Low Priority)

1. Fix waveform extraction to return proper data structure
2. Ensure sample rate is preserved in processing

## Implementation Steps

### Step 1: Fix Import Issues

```python
# In settings_window.py, add at top:
from pathlib import Path
import asyncio

# Add cryptography with fallback:
try:
    from cryptography.fernet import Fernet
    ENCRYPTION_AVAILABLE = True
except ImportError:
    ENCRYPTION_AVAILABLE = False
    Fernet = None
```

### Step 2: Update Device Fallback Tests

```python
# Update all connect() calls to include force_reset=False
mock_device.connect.assert_called_with(
    target_interface_number=0,
    vid=4310,
    pid=expected_pid,
    auto_retry=True,
    force_reset=False  # Add this parameter
)
```

### Step 3: Fix Device Selector Mocking

```python
# Mock CTk widgets with proper numeric attributes
mock_parent = Mock()
mock_parent.winfo_width.return_value = 800
mock_parent.winfo_height.return_value = 600
# Add other numeric attributes as needed
```

### Step 4: Fix Settings Validation

```python
# Ensure validation methods return True for valid input
def _validate_numeric_settings(self):
    # ... validation logic ...
    return True  # Instead of False
```

### Step 5: Fix Missing Variables

```python
# Ensure ai_api_provider_var is created in local_vars
self.local_vars["ai_api_provider_var"] = tk.StringVar(value=config.get("ai_api_provider", "gemini"))
```

## Testing Strategy

1. **Run tests incrementally** after each fix category
2. **Use pytest markers** to test specific areas:
   - `pytest -k "device_fallback"` for device tests
   - `pytest -k "settings"` for settings tests
3. **Check coverage** after fixes: `pytest --cov=. --cov-report=html`
4. **Validate no regressions** in passing tests

## Success Criteria

1. All 25 failing tests pass
2. No regression in the 577 passing tests
3. Code coverage reaches or exceeds 80%
4. All imports and dependencies properly handled
5. Device functionality works with new parameters
6. Settings dialog functions correctly with all providers

## Post-Fix Actions

1. Run full test suite to ensure no regressions
2. Generate coverage report and identify gaps
3. Update documentation if APIs changed
4. Remove this temporal planning document
5. Commit fixes with appropriate messages
