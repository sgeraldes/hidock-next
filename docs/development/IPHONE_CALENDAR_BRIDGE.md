# iPhone Calendar Bridge

Use this when a work account is visible in Calendar on an iPhone but the organisation does not approve HiDock Next for
Microsoft 365 access. The Shortcut exports only calendar details already visible to the signed-in user. HiDock Next reads
the resulting file locally and sends the meetings through its existing recording-matching pipeline.

> Before using personal iCloud Drive, confirm that your organisation permits work-calendar details there. If it does not,
> save the file to an approved Files/OneDrive location that is also available on the Mac.

## 1. Create the iPhone Shortcut

In **Shortcuts** on the iPhone, create a shortcut named **Export Work Calendar for HiDock**.

Add these actions in order:

1. Add **Current Date**, then two **Adjust Date** actions which both use that original Current Date: subtract 30 days for
   `Window Start`, and add 90 days for `Window End`.
2. **Find Calendar Events**
   - Start Date: **is between** `Window Start` and `Window End`
   - Calendar: select the work calendar that shows the real meeting names
   - Sort by: **Start Date**, oldest first
   - Limit: **500**
3. Add **Count** for the results from Find Calendar Events and save it as the variable `Event Count`.
4. **Text** containing this header exactly:

   ```text
   title|||start|||end|||location|||url
   ```

5. **Set Variable** named `Export Lines` to that Text.
6. **Repeat with Each** item from Find Calendar Events.
7. Inside the repeat, use **Get Details of Calendar Events** to obtain:
   - Title (called Name on some iOS versions)
   - Start Date
   - End Date
   - Location
   - URL
8. Add **Format Date** for Start Date and End Date. For each, choose **Custom** and use:

   ```text
   yyyy-MM-dd'T'HH:mm:ssZZZZZ
   ```

9. Add a **Text** action containing the five values in this order, separated by three `|` characters:

   ```text
   [Title]|||[Formatted Start Date]|||[Formatted End Date]|||[Location]|||[URL]
   ```

   Insert each bracketed item as a blue Shortcuts variable; do not type the brackets. If a title or location contains line
   breaks, use **Replace Text** to replace them with spaces before building this line.
10. **Add to Variable** `Export Lines`.
11. End the repeat. Add a **Text** action containing `END|||` followed by the blue `Event Count` variable, then **Add to
    Variable** `Export Lines`. This final count lets HiDock detect an incomplete iCloud upload.
12. Add **Combine Text** for `Export Lines`, separated by **New Lines**.
13. Add **Save File**:
    - Destination: `iCloud Drive/Shortcuts/HiDock/work-calendar.txt`
    - Turn **Ask Where to Save** off
    - Turn **Overwrite If File Exists** on

Run the shortcut once. When prompted, allow access to the work calendar and iCloud Drive.

## 2. Connect the file to HiDock Next

1. On the Mac, wait for `work-calendar.txt` to appear in iCloud Drive.
2. Open **HiDock Next → Settings → Calendar**.
3. Select **iPhone Shortcut**.
4. Choose `work-calendar.txt`, save the settings, then select **Sync Now**.
5. Open **Calendar** in HiDock Next. The work meeting titles should now appear and will be considered when matching new
   recordings.

HiDock Next rejects the complete import if any row is malformed, a date is invalid, a meeting ends before it starts, or the
final event count is missing. HTTPS Microsoft Teams links are retained; other links are ignored. The last valid snapshot
remains authoritative for automatic matching.

## 3. Automate it on the iPhone

In **Shortcuts → Automation**, create a **Time of Day** automation (for example, 06:00 every day), add **Run Shortcut**,
choose **Export Work Calendar for HiDock**, and choose **Run Immediately**. HiDock Next can then reread the file on its
normal calendar sync interval.

If iCloud has not downloaded the newest file yet, HiDock reports the error without changing the last successfully imported
calendar.
