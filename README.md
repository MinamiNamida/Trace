# Trace

Trace is a local-first spatial board for learning notes, code, formulas, images, sketches, named regions, and stories. It uses React, TypeScript, DOM/SVG, KaTeX, highlight.js, perfect-freehand, Zustand, IndexedDB, and Reveal.js.

Try it online: [Trace on GitHub Pages](https://minaminamida.github.io/Trace/).

Run with `pnpm install` and `pnpm dev`. Run regression tests with `pnpm test` and check the production build with `pnpm build`. Open the local URL shown by Vite. The default Fourier example is replaced by an editable Chinese Markdown getting-started board, with four frames covering navigation, content editing, visual tools, and stories/export. Unchanged saved copies of the old example are updated; user-edited boards are preserved. Subsequent edits save in IndexedDB. Image files live in a separate IndexedDB asset store rather than the Board JSON.

Use the board title menu to create a blank board, switch between boards saved in this browser, or delete a board using the trash button beside its title. Deletion asks for confirmation and removes its stories and image assets that no other board uses. Deleting the last board opens a new blank board.

## Working on the board

- Drag empty board space to select several items. Hold the middle mouse button anywhere on the board, or drag with Space or the Hand tool, to pan. On a touch screen, drag empty space with one finger to pan and pinch with two fingers to zoom. Trackpad scroll pans; mouse wheel and the zoom controls also zoom.
- Drag an item or frame near another item's edge or center to align it. The same snapping works when moving several items or resizing an item or frame. Hold Alt while dragging to bypass snapping.
- Double-click or double-tap text, code blocks, formulas, or frame titles to edit. New text, code blocks, and formulas begin editing immediately. Click or tap elsewhere, or press Cmd/Ctrl Enter to finish. Empty new items are discarded.
- Text uses Vditor's instant rendering mode. The block under the cursor shows Markdown syntax such as `$1$` and `**bold**`, then renders again when the cursor leaves. Type `$...$` for inline math or `$$...$$` for display math. Existing plain-text notes keep their original display until edited.
- Choose **Code block** or press **C**, then click the board. Select a language in the editor to highlight the code on the board and in presentations.
- Formula editing takes LaTeX source directly and shows a live KaTeX preview.
- Use Frame to drag a named region. A frame binds fully enclosed items; moving it moves its contents. Resizing changes membership without scaling content. Right-click to select or detach its contents, or remove just the frame and keep content. Delete normally removes both the frame and its contents. Existing saved boards gain frame membership on first open.
- Drag the subtle handle beside a frame title to another frame to create an edge. Select an edge and press Delete to remove it.
- Drop, paste, or pick images. Draw with Pen and remove strokes with Eraser.
- Right-click the canvas for undo/redo, cut/copy/paste, duplicate, group/ungroup, wrap selection in a frame, select all, focus, and delete. Shift-click adds/removes objects; Cmd/Ctrl-click selects a single group member. Cmd/Ctrl G groups objects (including frames); Cmd/Ctrl Shift G ungroups one nesting level. Grouping and frame membership survive saving, clipboard transfer, and undo. Cmd/Ctrl C/X/V and D work for multi-selection. Clipboard copies embed images for transfer between boards/tabs; when system clipboard access is blocked, menu paste can use the in-app copy.
- Cmd/Ctrl Z and Cmd/Ctrl Shift Z edit document history. The lower-right arrows navigate camera history.

## Stories and presentation

Open **Story** at the top right. Create an empty story or build one from the current frame order, then add, repeat, remove, or reorder frame steps. A step can use its frame bounds or a captured board viewport. Story steps only reference the Board; no canvas content is copied. You can keep multiple Stories for different explanations, duplicate a Story, or delete one without changing the Board.

Select a step and choose **Reveal** to set items that touch its frame to visible, reveal in order, or hidden. The reveal list controls the order of fragment advances. Choose **Notes** to write speaker notes for that step. Reveal settings reference existing Board items; they do not make slide copies.

Choose **Present** to run the Story with Reveal.js. Arrow keys or the on-screen controls advance through reveals and steps. Press **S** or choose **Notes** to open the speaker view. Press Esc or choose **Explore** to pan and zoom freely, then resume the current step. The same `BoardRenderer` renders editor and presentation content.

Choose **HTML** in the Story editor to download a standalone presentation with embedded images, formula fonts, Reveal.js, and notes. It opens without a server or account. Choose **PDF** in the Story editor or the print button in Presentation to open a self-contained print snapshot and its print dialog; select **Save as PDF**. Each story step becomes one page, including all reveals. Exported HTML also includes **Print / Save as PDF**. Allow pop-ups for Trace if the browser blocks the print window. The editor keeps the same spatial layout at every zoom, while details fade at distant zoom levels and frame titles and edges remain visible.

## Earlier demo image attribution

The earlier Fourier study board included a crop of page 70, “Time shift,” from *Engineering Signal Analysis: From Fourier to filtering: Theory* by Christian Tiberius and Max Mulder, TU Delft OPEN Books, 2026. [Source](https://books.open.tudelft.nl/home/catalog/book/247). Licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The crop removes page margins and later sections; formulas and text are otherwise unchanged.
