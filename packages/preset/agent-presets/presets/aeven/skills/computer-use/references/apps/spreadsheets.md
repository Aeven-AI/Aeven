# Spreadsheets

Excel, Numbers, LibreOffice Calc, and Google Sheets in an app window.

- More than a few cells of new data: write a `.csv` or `.xlsx` file and open it, or paste tab-separated text with `clipboard_write` and paste, instead of typing cell by cell.
- Click a cell to select it; typing then replaces its content. Double-click (or F2 in Excel and LibreOffice) edits the content in place.
- Within one row, separate values with Tab in a single `type_text`; press Return between rows. Enter one row or one formula per call; longer runs drop keys.
- Formulas start with `=`. Read the cell back to check the computed value, not just the formula.
- Numbers saves as it goes. Excel and LibreOffice need Save (`cmd+s` on macOS, `ctrl+s` elsewhere); the first save opens a dialog for the name and folder.
- Checkbox cells accept `1` and `0` in Numbers.
- LibreOffice ignores keys sent in the background: use the foreground fallback or the file route.
