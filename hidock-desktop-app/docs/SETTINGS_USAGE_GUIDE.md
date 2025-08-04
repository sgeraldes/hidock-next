# Settings Persistence - Usage Guide

## Overview

The settings persistence system has been fixed to prevent settings from being overwritten. This guide explains the correct usage patterns.

## Functions Available

### `save_config(config_data)`

- **Purpose**: Saves configuration data, merging with existing settings
- **Behavior**: Automatically merges new settings with existing ones to preserve all settings
- **Usage**: Can be used with either full config objects or partial settings

### `update_config_settings(settings_dict)`

- **Purpose**: Updates only specific settings (alias for save_config)
- **Behavior**: Same as save_config - merges with existing settings
- **Usage**: Preferred for updating only a few specific settings

## Current Usage Patterns

### ✅ Correct Usage

```python
# For small/frequent changes (RECOMMENDED)
update_config_settings({
    'treeview_sort_col_id': 'name',
    'treeview_sort_descending': True
})

# For application shutdown (saves everything at once)
save_config(self.config)  # Only use for bulk saves
```

### ❌ Problematic Usage (Now Fixed)

The following pattern was problematic before the fix but now works correctly:

```python
# This used to overwrite all settings, but now merges correctly
partial_config = {'log_level': 'DEBUG'}
save_config(partial_config)  # Now preserves other settings
```

## Recommendations

### For Application Code

1. **Use update_config_settings for small/frequent changes** (RECOMMENDED):

   ```python
   update_config_settings({
       'treeview_sort_col_id': 'name',
       'treeview_sort_descending': False
   })
   ```

2. **Use save_config only for bulk operations**:

   ```python
   # Only for application shutdown or settings dialog
   save_config(self.config)
   ```

### For Column Sorting

Column sorting should ONLY use targeted updates:

```python
# CORRECT: Only save what changed
update_config_settings({
    'treeview_sort_col_id': column,
    'treeview_sort_descending': reverse
})

# WRONG: Don't save entire config for small changes
# save_config(self.config)  # Inefficient!
```

## Implementation Details

### Merge Logic

The `save_config` function now:

1. Loads existing config from file (or defaults if file missing/corrupted)
2. Merges new settings with existing ones (new settings take precedence)
3. Saves the merged configuration
4. Logs the number of settings merged

### Error Handling

- Handles missing config files gracefully
- Handles corrupted JSON files by falling back to defaults
- Preserves existing settings even if save operation partially fails

## Migration Notes

- **No code changes required** - all existing code continues to work
- **Improved reliability** - settings are now preserved across saves
- **Better logging** - save operations now log merge information

## Testing

The fix includes comprehensive tests:

- `test_settings_persistence_focused.py` - Identifies root cause
- `test_settings_persistence_fix.py` - Verifies fix works correctly
- Tests cover partial saves, full saves, corrupted files, and missing files

## Troubleshooting

If settings are still not being saved:

1. Check file permissions on the config file
2. Verify the config directory is writable
3. Check logs for save_config error messages
4. Ensure the setting key names match the expected config keys

## Example: Column Sorting Implementation

```python
def on_column_click(self, column_id):
    """Handle column header click for sorting."""
    # Determine new sort order
    if self.current_sort_column == column_id:
        self.sort_reverse = not self.sort_reverse
    else:
        self.current_sort_column = column_id
        self.sort_reverse = False

    # Save sorting preferences
    update_config_settings({
        'treeview_sort_col_id': self.current_sort_column,
        'treeview_sort_descending': self.sort_reverse
    })

    # Apply sorting to treeview
    self.apply_sort_to_treeview()
```

This ensures column sorting preferences are immediately saved and will persist across application restarts.
