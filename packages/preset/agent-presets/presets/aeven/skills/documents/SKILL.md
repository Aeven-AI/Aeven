---
name: documents
description: Make a document file — a letter, objection, application, statement, report, contract, form or handout — as PDF, Word (DOCX) or Pages from HTML you write. Use whenever the person wants a document to download, print, sign, send or upload, and before converting HTML to PDF or Word. CVs use the cv skill and presentations the slides skill.
user-invocable: false
---

# Documents

The person gets the file they asked for, never its HTML source.

## Pick the format

- The format the person names is the one you deliver. With none named, deliver a PDF.
- Add a Word file only when they ask for Word or DOCX or want to keep editing, and a Pages file only when they ask for Pages.
- A failed conversion is a command to fix, not a reason to switch formats. When a format truly cannot be made here, say so and name the format you made instead.

## Make it

1. Give the document its own folder and write it there as one HTML file with print CSS: `@page { size: A4; margin: 20mm; }`, real fonts, and no placeholders the person did not ask for.
2. Print the PDF with Chrome (on Linux `google-chrome` or `chromium`; on Windows `chrome.exe` or `msedge.exe`), all of these flags included:

   ```sh
   cd "<folder>" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --disable-gpu \
     --no-first-run --no-pdf-header-footer --user-data-dir="$PWD/.chrome-profile" \
     --print-to-pdf="$PWD/<name>.pdf" "file://$PWD/<name>.html"; rm -rf .chrome-profile
   ```

   Inside the workspace sandbox Chrome's own sandbox cannot start, so without `--no-sandbox` it writes no PDF and prints only crash-report errors; the workspace sandbox still confines it. Its default profile and temporary folders are outside what the sandbox lets it write, so the profile goes in a hidden folder beside the document. Crashpad and `CVDisplayLink` errors in the output are harmless; the `bytes written to file` line is the result.
3. Check the PDF: `pdfinfo <name>.pdf` for the page count, and look at the pages before you hand it over.
4. Word, when asked: `textutil -convert docx -output <name>.docx <name>.html` on a Mac, else `soffice --headless --convert-to docx <name>.html` or `pandoc <name>.html -o <name>.docx`.
5. Pages, when asked, on a Mac with Pages: convert the Word file with `osascript -e 'tell application id "com.apple.Pages"' -e 'set d to open (POSIX file "<folder>/<name>.docx")' -e 'save d in (POSIX file "<folder>/<name>.pages")' -e 'close d saving no' -e 'end tell'`. The workspace sandbox refuses Apple Events, so run it with the sandbox escalation and "convert the document to Pages" as the reason.

## Hand it over

Run each conversion with the bash tool's `output_files` set to the files it writes, each path in full, so the files are listed with your reply. In the reply, link each file by its full path, `[<name>.pdf](<folder>/<name>.pdf)`, and leave the HTML out.
