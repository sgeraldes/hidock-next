# Example: Efficient Column Sorting Implementation

def save_column_sort_preferences(self, column_id, reverse_order):
    """Save column sorting preferences efficiently."""
    from config_and_logger import update_config_settings
    
    # Update instance variables
    self.treeview_sort_column = column_id
    self.treeview_sort_reverse = reverse_order
    
    # Save only the sorting preferences - not the entire config
    update_config_settings({
        'treeview_sort_col_id': column_id,
        'treeview_sort_descending': reverse_order
    })

def on_column_header_click(self, column_id):
    """Handle column header click for sorting."""
    # Toggle sort order if same column, otherwise default to ascending
    if self.treeview_sort_column == column_id:
        new_reverse = not self.treeview_sort_reverse
    else:
        new_reverse = False
    
    # Save preferences immediately
    self.save_column_sort_preferences(column_id, new_reverse)
    
    # Apply sorting to treeview
    self.apply_sort_to_treeview(column_id, new_reverse)