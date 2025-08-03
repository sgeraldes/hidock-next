# Testing Guide

Comprehensive testing guide for the HiDock Next project covering all three applications.

## 🎯 Testing Philosophy

HiDock Next follows a **test-driven development (TDD)** approach with comprehensive coverage:

- **581 total tests** across the desktop application
- **80% minimum coverage** requirement (enforced)
- **Multiple test categories:** Unit, Integration, Device, Performance
- **Continuous Integration:** Automated testing on every commit
- **Mock-first approach:** External dependencies mocked for reliability

## Table of Contents

- [Overview](#overview)
- [Desktop Application Testing](#desktop-application-testing)
- [Web Application Testing](#web-application-testing)
- [Audio Insights Extractor Testing](#audio-insights-extractor-testing)
- [Integration Testing](#integration-testing)
- [CI/CD Testing](#cicd-testing)

## Overview

The HiDock Next project uses different testing frameworks for each application:

- **Desktop App:** pytest for Python
- **Web App:** Vitest for React/TypeScript
- **Audio Insights:** Vitest for React/TypeScript

### Testing Philosophy

1. **Unit Tests:** Test individual components/functions in isolation
2. **Integration Tests:** Test component interactions
3. **Device Tests:** Test actual HiDock hardware (when available)
4. **Mock Tests:** Test with simulated devices and AI providers

## Desktop Application Testing

### Setup

```bash
cd hidock-desktop-app
# Install with development dependencies (recommended)
pip install -e ".[dev]"

# Or install manually
pip install -r requirements.txt
pip install pytest pytest-cov pytest-mock pytest-asyncio
```

### Running Tests

```bash
# Run all tests (581 tests as of current version)
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_settings_window.py

# Run specific test class
pytest tests/test_settings_window.py::TestSettingsDialog

# Run with coverage (configured for 80% minimum)
pytest --cov=. --cov-report=html

# Run by marker
pytest -m unit          # Unit tests only
pytest -m integration   # Integration tests only
pytest -m device        # Device tests (requires hardware)
pytest -m slow          # Slow running tests
```

### Test Structure

```
hidock-desktop-app/
├── tests/
│   ├── __init__.py
│   ├── conftest.py                    # Shared fixtures
│   ├── test_audio_player.py           # Audio playback tests
│   ├── test_audio_player_enhanced.py  # Enhanced audio features
│   ├── test_audio_processing_advanced.py # Audio processing
│   ├── test_audio_visualization.py    # Waveform & spectrum tests
│   ├── test_config_and_logger.py      # Configuration tests
│   ├── test_device_communication.py   # USB device communication
│   ├── test_device_interface.py       # Device interface layer
│   ├── test_device_selector_*.py      # Device selector components
│   ├── test_file_operations.py        # File management
│   ├── test_gui_components.py         # GUI component tests
│   ├── test_main.py                   # Main application tests
│   ├── test_settings_*.py             # Settings dialog tests (comprehensive)
│   ├── test_transcription*.py         # AI transcription tests
│   └── test_usb_device_selection.py   # USB device selection
├── pytest.ini                         # pytest configuration
└── pyproject.toml                      # Project configuration with test settings
```

### Writing Tests

#### Unit Test Example

```python
import pytest
from unittest.mock import Mock, patch
from settings_window import SettingsDialog

class TestSettingsDialog:
    @pytest.mark.unit
    def test_validate_numeric_settings_valid_values(self):
        """Test that valid numeric settings pass validation."""
        # Test implementation with proper mocking
        mock_parent = Mock()
        mock_config = {"temperature": 0.7, "max_tokens": 4000}

        dialog = SettingsDialog(mock_parent, mock_config, Mock())
        result = dialog._validate_numeric_settings()
        assert result is True

    @pytest.mark.unit
    def test_temperature_validation_range(self):
        """Test temperature validation enforces 0.0-2.0 range."""
        # Test that temperature must be between 0.0 and 2.0
        dialog = self._create_test_dialog()
        dialog.local_vars["ai_temperature_var"].set(2.5)  # Invalid

        result = dialog._validate_numeric_settings()
        assert result is False
```

#### Integration Test Example

```python
@pytest.mark.integration
def test_settings_dialog_complete_workflow(mock_parent_gui):
    """Test complete settings dialog workflow."""
    # Test full settings dialog lifecycle
    initial_config = {"ai_temperature": 0.7, "ai_max_tokens": 4000}
    dialog = SettingsDialog(mock_parent_gui, initial_config, Mock())

    # Change settings
    dialog.local_vars["ai_temperature_var"].set(1.0)
    dialog.local_vars["ai_max_tokens_var"].set(8000)

    # Apply settings
    dialog._perform_apply_settings_logic()

    # Verify changes were applied
    assert mock_parent_gui.config["ai_temperature"] == 1.0
    assert mock_parent_gui.config["ai_max_tokens"] == 8000

@pytest.mark.integration
def test_device_selector_bug_fix():
    """Test that device selector properly handles enable/disable."""
    from enhanced_device_selector import EnhancedDeviceSelector

    selector = EnhancedDeviceSelector(Mock())

    # Test the bug fix - should not raise AttributeError
    selector.set_enabled(False)
    assert selector._scan_button.cget("state") == "disabled"

    selector.set_enabled(True)
    assert selector._scan_button.cget("state") == "normal"
```

#### Device Test Example

```python
@pytest.mark.device
@pytest.mark.skipif(not has_device(), reason="No HiDock device connected")
def test_real_device_connection():
    device = HiDockDevice()
    assert device.connect() is True
    assert device.get_device_info() is not None
```

### Mocking

```python
# Mock AI providers with comprehensive coverage
@pytest.fixture
def mock_ai_service(mocker):
    mock = mocker.patch('ai_service.AIServiceManager')
    mock.validate_provider.return_value = True
    mock.transcribe_audio.return_value = {
        "text": "Mocked transcription",
        "confidence": 0.95
    }
    return mock

# Mock device with enhanced functionality
@pytest.fixture
def mock_hidock_device(mocker):
    mock = mocker.patch('hidock_device.HiDockJensen')
    mock.is_connected.return_value = True
    mock.get_device_info.return_value = {
        "model": "H1E", "firmware": "1.2.3"
    }
    mock.get_device_settings.return_value = {
        "autoRecord": False, "autoPlay": True
    }
    return mock

# Mock GUI components for settings tests
@pytest.fixture
def mock_parent_gui(mocker):
    mock = Mock()
    mock.config = {"ai_temperature": 0.7, "ai_max_tokens": 4000}
    mock.download_directory = "/test/downloads"
    # Add all required attributes for settings dialog
    for attr in ["autoconnect_var", "ai_temperature_var", "ai_max_tokens_var"]:
        setattr(mock, attr, Mock())
    return mock
```

### Coverage Requirements

- **Minimum coverage: 80%** (enforced by pytest configuration)
- **Critical paths: 95%** (device communication, file operations)
- **GUI components: 70%** (due to CustomTkinter limitations)
- **Performance optimizations: 85%** (background processing, caching, deferred updates)
- **Settings functionality: 90%+** (comprehensive test coverage implemented)
- **AI integration: 80%** (with mock providers for testing)

### Current Test Statistics

- **Total Tests: 581** (as of latest version)
- **Test Categories:**
  - Unit tests: ~400
  - Integration tests: ~150
  - Device tests: ~30 (require hardware)
  - Performance tests: ~20

## Web Application Testing

### Setup

```bash
cd hidock-web-app
npm install
```

### Running Tests

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# With UI
npm run test:ui

# Coverage report
npm run test:coverage

# Specific file
npm run test src/services/deviceService.test.ts
```

### Test Structure

```
hidock-web-app/
├── src/
│   ├── test/
│   │   ├── setup.ts           # Test setup
│   │   └── utils.tsx          # Test utilities
│   ├── services/
│   │   ├── deviceService.test.ts
│   │   └── geminiService.test.ts
│   └── components/
│       └── __tests__/         # Component tests
└── vitest.config.ts           # Vitest configuration
```

### Writing Tests

#### Component Test Example

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceList } from '../DeviceList';

describe('DeviceList', () => {
  it('displays connected devices', () => {
    const devices = [
      { id: '1', name: 'HiDock H1', status: 'connected' }
    ];

    render(<DeviceList devices={devices} />);

    expect(screen.getByText('HiDock H1')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('handles device selection', () => {
    const onSelect = vi.fn();
    render(<DeviceList devices={devices} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('HiDock H1'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });
});
```

#### Service Test Example

```typescript
import { deviceService } from '../deviceService';
import { mockDevice } from '../test/utils';

describe('DeviceService', () => {
  it('connects to device', async () => {
    const device = mockDevice();
    const result = await deviceService.connect(device);

    expect(result.success).toBe(true);
    expect(result.device).toBeDefined();
  });

  it('handles connection errors', async () => {
    const device = mockDevice({ failConnection: true });
    const result = await deviceService.connect(device);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to connect');
  });
});
```

### Mocking WebUSB

```typescript
// Mock WebUSB API
global.navigator.usb = {
  requestDevice: vi.fn().mockResolvedValue(mockUSBDevice),
  getDevices: vi.fn().mockResolvedValue([]),
};

// Mock USB Device
const mockUSBDevice = {
  open: vi.fn().mockResolvedValue(undefined),
  selectConfiguration: vi.fn().mockResolvedValue(undefined),
  claimInterface: vi.fn().mockResolvedValue(undefined),
  transferIn: vi.fn().mockResolvedValue({ data: new DataView(new ArrayBuffer(64)) }),
  transferOut: vi.fn().mockResolvedValue({ status: 'ok' }),
};
```

## Audio Insights Extractor Testing

### Setup

```bash
cd audio-insights-extractor
npm install
```

### Running Tests

Similar to web app, using Vitest:

```bash
npm run test
npm run test:watch
npm run test:coverage
```

### Test Focus Areas

1. **Audio Processing:**
   - File upload handling
   - Format validation
   - Size limits

2. **AI Integration:**
   - Gemini API mocking
   - Error handling
   - Rate limiting

3. **UI Components:**
   - Audio waveform display
   - Transcription display
   - Error states

## Integration Testing

### Cross-Application Testing

```bash
# Run all application tests
npm run test:all

# Desktop + Web integration
pytest tests/integration/test_desktop_web_integration.py
```

### Device Integration Tests

```python
@pytest.mark.integration
@pytest.mark.device
def test_full_recording_workflow():
    """Test complete workflow from device to transcription"""
    # 1. Connect to device
    device = HiDockDevice()
    assert device.connect()

    # 2. List recordings
    recordings = device.list_recordings()
    assert len(recordings) > 0

    # 3. Download recording
    audio_data = device.download_recording(recordings[0])
    assert audio_data is not None

    # 4. Transcribe
    transcription = ai_service.transcribe(audio_data)
    assert transcription.text != ""
```

## CI/CD Testing

### GitHub Actions Workflow

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - run: |
          cd hidock-desktop-app
          pip install -r requirements.txt
          pytest --cov=. --cov-report=xml

  test-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: |
          cd hidock-web-app
          npm ci
          npm run test:coverage
```

### Pre-commit Hooks

```bash
# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Run manually
pre-commit run --all-files
```

## Best Practices

### 1. Test Naming

- **Be descriptive:** `test_settings_dialog_validates_temperature_range`
- **Group related tests in classes:** `TestSettingsDialog`, `TestDeviceSelector`
- **Use consistent naming patterns:** `test_[component]_[action]_[expected_result]`
- **Follow TDD approach:** Write failing tests first, then implement

### 2. Test Data

```python
# Use fixtures for test data
@pytest.fixture
def sample_audio_file(tmp_path):
    """Create a sample WAV file for testing."""
    file_path = tmp_path / "test.wav"
    # Create minimal WAV file for testing
    import wave
    with wave.open(str(file_path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        wav.writeframes(b'\x00\x00' * 1000)
    return file_path

@pytest.fixture
def sample_config():
    """Provide sample configuration for testing."""
    return {
        "ai_temperature": 0.7,
        "ai_max_tokens": 4000,
        "ai_api_provider": "gemini",
        "download_directory": "/test/downloads"
    }
```

### 3. Async Testing

```typescript
// Testing async operations
it('loads device data asynchronously', async () => {
  const promise = deviceService.loadDevices();

  // Assert loading state
  expect(deviceService.isLoading).toBe(true);

  const devices = await promise;

  // Assert loaded state
  expect(devices).toHaveLength(2);
  expect(deviceService.isLoading).toBe(false);
});
```

### 4. Error Testing

Always test error paths:

```python
def test_handles_device_disconnect():
    device = connect_device()
    device.disconnect()

    with pytest.raises(DeviceNotConnectedError):
        device.list_recordings()
```

### 5. Performance Testing

```python
@pytest.mark.performance
def test_large_file_processing(benchmark):
    """Test performance of large audio file processing."""
    large_file = create_large_audio_file(size_mb=100)

    result = benchmark(process_audio_file, large_file)

    assert result.duration < 5.0  # Should process in under 5 seconds

@pytest.mark.performance
def test_settings_dialog_responsiveness():
    """Test settings dialog responds quickly to changes."""
    dialog = create_test_settings_dialog()

    start_time = time.time()
    # Simulate rapid setting changes
    for i in range(10):
        dialog.local_vars["ai_temperature_var"].set(i * 0.1)
    response_time = time.time() - start_time

    assert response_time < 0.1  # Should respond in under 100ms

@pytest.mark.performance
def test_device_info_caching():
    """Test intelligent caching reduces device communication."""
    device = mock_device()

    # First call should hit device
    info1 = device.get_device_info()
    assert device.communication_count == 1

    # Second call within 30s should use cache
    info2 = device.get_device_info()
    assert device.communication_count == 1
    assert info1 == info2

@pytest.mark.performance
def test_waveform_background_loading():
    """Test background waveform loading with cancellation."""
    mock_window = Mock()

    # Start waveform loading
    mock_window.load_waveform_background("test1.wav")
    assert mock_window.waveform_loading_active

    # Change selection should cancel previous loading
    mock_window.load_waveform_background("test2.wav")
    assert mock_window.previous_waveform_cancelled
```

## Debugging Tests

### Python Debugging

```bash
# Run with pdb
pytest --pdb

# Run specific test with debugging
pytest -k test_name --pdb

# Add breakpoint in code
import pdb; pdb.set_trace()
```

### JavaScript Debugging

```typescript
// Add debugger statement
debugger;

// Run with Node debugging
node --inspect-brk ./node_modules/.bin/vitest
```

## Test Reports

### Coverage Reports

- **Python:** HTML reports in `htmlcov/` (open `htmlcov/index.html`)
- **Current Coverage:** ~17% overall (target: 80%)
- **Coverage by Component:**
  - Settings functionality: 85%+ (comprehensive testing)
  - Device communication: 55%
  - Audio processing: 20%
  - GUI components: 11% (due to CustomTkinter limitations)

### CI Reports

- **GitHub Actions:** Automated test execution on push/PR
- **Test results:** Posted as PR comments with detailed breakdown
- **Coverage tracking:** HTML reports generated and stored
- **Failed test logs:** Available in Actions tab with full stack traces
- **Performance benchmarks:** Tracked for critical operations

### Test Metrics Dashboard

```bash
# Generate comprehensive test report
pytest --cov=. --cov-report=html --cov-report=term-missing --junit-xml=test-results.xml

# View coverage by file
pytest --cov=. --cov-report=term-missing | grep -E "(TOTAL|settings_window|device_)"

# Run only fast tests for development
pytest -m "not slow and not device"
```

## Troubleshooting Tests

### Common Issues

1. **Import errors:**
   - Check virtual environment: `source .venv/bin/activate`
   - Install with dev dependencies: `pip install -e ".[dev]"`
   - Verify PYTHONPATH includes project root

2. **Settings dialog test failures:**
   - Ensure CustomTkinter is properly mocked
   - Check that all required GUI variables are initialized
   - Verify encryption dependencies are available

3. **Async timeouts:**
   - Increase timeout for device communication tests
   - Use `pytest-asyncio` for proper async test handling
   - Mock slow operations in unit tests

4. **Mock conflicts:**
   - Clear mocks between tests using `pytest.fixture(autouse=True)`
   - Use `mocker.resetall()` in teardown
   - Isolate tests with proper fixture scoping

5. **Device tests failing:**
   - Skip device tests when no hardware: `@pytest.mark.skipif(not has_device())`
   - Use mock devices for CI/CD environments
   - Ensure USB permissions on Linux systems

6. **Coverage issues:**
   - Check `.coveragerc` configuration
   - Exclude GUI-only code that can't be tested
   - Use `# pragma: no cover` for unreachable code

### Getting Help

- **Check test output carefully:** Use `pytest -v` for detailed output
- **Run single test in isolation:** `pytest tests/test_settings_window.py::TestSettingsDialog::test_specific_method -v`
- **Use verbose mode:** `pytest -v -s` to see print statements
- **Check CI logs:** GitHub Actions logs show full test execution
- **Debug with breakpoints:** Use `pytest --pdb` to drop into debugger
- **Check coverage reports:** Open `htmlcov/index.html` after running coverage
- **Validate test configuration:** Ensure `pytest.ini` and `pyproject.toml` are properly configured

### Test Development Workflow

1. **Write failing test first** (Red)
2. **Implement minimal code to pass** (Green)
3. **Refactor and improve** (Refactor)
4. **Run full test suite** to ensure no regressions
5. **Check coverage** and add tests for uncovered code
6. **Update documentation** if needed
