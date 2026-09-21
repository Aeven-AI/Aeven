/**
 * The capability model: which semantic operations the recipes cover.
 *
 * Derived from the validated operation catalogs published by `X-PLUG/OSWorld-MCP`,
 * which enumerate, per application, the semantic operations its tools perform —
 * `CalcTools.set_cell_value`, `WriterTools.find_and_replace`, and 130 more. A tool
 * catalog says what an application can be *asked* to do, with the argument names
 * already decided, which is exactly the vocabulary a recipe needs.
 *
 * This file records which of those operations this book implements, so coverage is
 * a fact rather than an impression. A name-overlap heuristic was tried first and
 * removed: it reported `save` as uncovered because the recipe is called
 * `spreadsheet.saveAs`, which is the kind of false gap that makes a coverage report
 * untrustworthy.
 *
 * @module @aeven/computer-use-router/capabilities
 */

/** How a catalog operation is covered by this book. */
export interface CapabilityCoverage {
  /** The operation as the catalog names it, e.g. `CalcTools.set_cell_value`. */
  operation: string
  /** The task implementing it, or absent when the book has no recipe. */
  task?: string
  /** Why the book has no recipe, when it does not. */
  uncoveredBecause?: string
}

/**
 * LibreOffice Calc coverage.
 *
 * The catalog lists 31 operations across `CalcTools` and `CalcToolsPlus`.
 */
export const CALC_COVERAGE: readonly CapabilityCoverage[] = [
  { operation: 'CalcTools.set_cell_value', task: 'spreadsheet.setCell' },
  { operation: 'CalcTools.get_column_data', task: 'spreadsheet.getColumnValues' },
  { operation: 'CalcTools.set_column_values', task: 'spreadsheet.setColumnValues' },
  { operation: 'CalcTools.save', task: 'spreadsheet.saveAs' },
  { operation: 'CalcTools.export_to_csv', task: 'spreadsheet.exportCsv' },
  { operation: 'CalcTools.export_to_pdf', task: 'spreadsheet.exportPdf' },
  { operation: 'CalcTools.create_chart', task: 'spreadsheet.createChart' },
  { operation: 'CalcTools.create_pivot_table', task: 'spreadsheet.createPivotTable' },
  { operation: 'CalcTools.sort_column', task: 'spreadsheet.sortColumn' },
  { operation: 'CalcTools.create_sheet' },
  { operation: 'CalcTools.rename_sheet', uncoveredBecause: 'the operation is one line on the same UNO surface as spreadsheet.createSheet, so it is deferred rather than duplicated' },
  { operation: 'CalcTools.merge_cells', uncoveredBecause: 'deferred: needs a range address parsed into UNO cell coordinates, which spreadsheet.selectRange does not yet do' },
  { operation: 'CalcTools.format_range', uncoveredBecause: 'deferred: formatting is the rung this stack is weakest at, and a half-measure would mislead' },
  { operation: 'CalcTools.highlight_range', uncoveredBecause: 'deferred with format_range: it is the same UNO property surface' },
  { operation: 'CalcTools.reorder_columns', uncoveredBecause: 'deferred: needs a column-move primitive the book has no other use for yet' },
  { operation: 'CalcTools.transpose_range', uncoveredBecause: 'deferred: computed rather than set, so it needs its own verification design' },
  { operation: 'CalcTools.freeze_panes', uncoveredBecause: 'deferred: a view setting rather than document content, so it falls outside what these assertions check' },
  { operation: 'CalcTools.set_number_format', uncoveredBecause: 'deferred with format_range' },
  { operation: 'CalcTools.adjust_column_width', uncoveredBecause: 'deferred: a layout setting whose verification would need a screenshot' },
  { operation: 'CalcTools.adjust_row_height', uncoveredBecause: 'deferred with adjust_column_width' },
  { operation: 'CalcTools.set_zoom_level', uncoveredBecause: 'deferred: a view-only setting, and the sources pair it with a visual check' },
  { operation: 'CalcTools.switch_active_sheet', uncoveredBecause: 'deferred: sheet selection is a precondition for other operations rather than a task a user asks for' },
  { operation: 'CalcTools.copy_sheet', uncoveredBecause: 'deferred: Verifiable through sheet existence, but no source task needed it yet' },
  { operation: 'CalcTools.reorder_sheets', uncoveredBecause: 'deferred with copy_sheet' },
  { operation: 'CalcTools.hide_row_data', uncoveredBecause: 'deferred: a display toggle rather than document content' },
  { operation: 'CalcTools.get_workbook_info', task: 'spreadsheet.getInfo' },
  { operation: 'CalcTools.env_info', uncoveredBecause: 'harness introspection rather than a user task' },
  { operation: 'CalcToolsPlus.fill_blank_down', task: 'spreadsheet.fillBlanksDown' },
  { operation: 'CalcToolsPlus.auto_fill_down', uncoveredBecause: 'deferred: overlaps fill_blank_down, and the two differ in a way its description does not pin down' },
  { operation: 'CalcToolsPlus.copy_cells_between_sheets', uncoveredBecause: 'deferred: needs two-sheet addressing, which the cell operations do not yet parse' },
  { operation: 'CalcToolsPlus.format_numbers_to_human_readable', uncoveredBecause: 'deferred with format_range' },
  { operation: 'CalcToolsPlus.scale_first_sheet_and_export_pdf', uncoveredBecause: 'deferred: composes two operations, and the scale step is layout' },
]

/** LibreOffice Writer coverage. The catalog lists 15 operations. */
export const WRITER_COVERAGE: readonly CapabilityCoverage[] = [
  { operation: 'WriterTools.write_text', task: 'document.appendText' },
  { operation: 'WriterTools.find_and_replace', task: 'document.findAndReplace' },
  { operation: 'WriterTools.set_font', task: 'document.setFont' },
  { operation: 'WriterTools.set_font_size', task: 'document.setFontSize' },
  { operation: 'WriterTools.set_paragraph_alignment', task: 'document.setAlignment' },
  { operation: 'WriterTools.set_line_spacing', task: 'document.setLineSpacing' },
  { operation: 'WriterTools.export_to_pdf', task: 'document.exportPdf' },
  { operation: 'WriterTools.insert_page_break', task: 'document.insertPageBreak' },
  { operation: 'WriterTools.add_page_numbers', task: 'document.addPageNumbers' },
  { operation: 'WriterTools.save', uncoveredBecause: 'covered by the save path shared with the other document operations' },
  { operation: 'WriterTools.set_color', uncoveredBecause: 'deferred with format_range: colour is the same UNO property surface' },
  { operation: 'WriterTools.set_default_font', uncoveredBecause: 'deferred: it changes a document default rather than run content, and its verification is a template-level property' },
  { operation: 'WriterTools.insert_formula_at_cursor', uncoveredBecause: 'deferred: embedding a formula object needs its own verification, since the text cannot show it' },
  { operation: 'WriterTools.insert_image_at_cursor', uncoveredBecause: 'deferred: needs an image path and a check that the object exists, which the container cannot answer' },
  { operation: 'WriterTools.env_info', uncoveredBecause: 'harness introspection rather than a user task' },
]

/** LibreOffice Impress coverage. The catalog lists 22 operations. */
export const IMPRESS_COVERAGE: readonly CapabilityCoverage[] = [
  { operation: 'ImpressTools.set_slide_font', task: 'slide.setFont' },
  { operation: 'ImpressTools.write_text', task: 'slide.setText' },
  { operation: 'ImpressTools.set_text_color', task: 'slide.setTextColor' },
  { operation: 'ImpressTools.set_textbox_alignment', task: 'slide.setTextAlignment' },
  { operation: 'ImpressTools.set_text_strikethrough', task: 'slide.setTextStrikethrough' },
  { operation: 'ImpressTools.set_background_color', task: 'slide.setBackgroundColor' },
  { operation: 'ImpressTools.set_slide_background', task: 'slide.setBackgroundImage' },
  { operation: 'ImpressTools.delete_content', task: 'slide.deleteContent' },
  { operation: 'ImpressTools.duplicate_slide', task: 'slide.duplicate' },
  { operation: 'ImpressTools.insert_image', task: 'slide.insertImage' },
  { operation: 'ImpressTools.position_box', task: 'slide.positionShape' },
  { operation: 'ImpressTools.export_to_image', task: 'presentation.exportImage' },
  { operation: 'ImpressTools.save_as', task: 'presentation.saveAs' },
  { operation: 'ImpressTools.configure_auto_save', task: 'presentation.configureAutoSave' },
  { operation: 'ImpressTools.go_to_slide', uncoveredBecause: 'navigation rather than a task: it changes which slide is current, and the recipes that need it address a slide by index directly' },
  { operation: 'ImpressTools.get_slide_count', uncoveredBecause: 'covered by the verification of slide.addSlide, which asserts the resulting page count' },
  { operation: 'ImpressTools.set_style', uncoveredBecause: 'deferred: a layout-level style change whose verification would need a visual check' },
  { operation: 'ImpressTools.set_slide_orientation', uncoveredBecause: 'deferred: a page property rather than content' },
  { operation: 'ImpressTools.insert_file', uncoveredBecause: 'deferred: needs a file path and an object-existence check the container cannot answer' },
  { operation: 'ImpressTools.save', uncoveredBecause: 'covered by presentation.saveAs through the shared save path' },
  { operation: 'ImpressTools.env_info', uncoveredBecause: 'harness introspection rather than a user task' },
  { operation: 'PresentationToolsUNO.convert_to_docx', uncoveredBecause: 'deferred: a format conversion whose only honest check is reopening the result' },
]

/** Every coverage record, for a caller that wants to report on all of them. */
export const CAPABILITY_COVERAGE: readonly CapabilityCoverage[] = [
  ...CALC_COVERAGE,
  ...WRITER_COVERAGE,
  ...IMPRESS_COVERAGE,
]

/**
 * Report how much of a catalog the book covers.
 * @param coverage - the records to count.
 * @returns covered and total counts.
 */
export function coverageSummary(coverage: readonly CapabilityCoverage[]): { covered: number, total: number } {
  return {
    covered: coverage.filter(entry => entry.task !== undefined).length,
    total: coverage.length,
  }
}
